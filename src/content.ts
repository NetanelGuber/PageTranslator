import { createBatches, runWithConcurrency } from "./shared/batching";
import { CoalescingRunner } from "./shared/coalescing-runner";
import { DiagnosticBuffer, diagnosticFor, type DiagnosticOutcome } from "./shared/diagnostics";
import { classifyUnitsForSite, shouldPrompt, type ClassifiedUnit } from "./shared/detection";
import { collectTranslationUnits, collectTranslationUnitsInSubtree, discoverAccessibleRoots, EXTENSION_HOST_ID, isDocument, isElement, restoreIfUnchanged, type ScanStats, type TranslationUnit, type UnitSkip } from "./shared/dom";
import { removePseudoOverride } from "./shared/pseudo";
import { SelfWriteTracker } from "./shared/mutation-tracker";
import { LruCache } from "./shared/lru-cache";
import { joinTranslatedChunks, splitText } from "./shared/chunking";
import { ProcessedMarker } from "./shared/processed-marker";
import { canBeTarget, normalizeLanguageCode, supportsPair } from "./shared/languages";
import { getLanguageCatalog, getSettings, getSourceLanguage, isAlwaysTranslate, isNeverTranslate, setAlwaysTranslate, setNeverTranslate } from "./shared/storage";
import type {
  LanguageInfo,
  PageState,
  RuntimeMessage,
  TranslationResponse,
  TranslatorSettings
} from "./shared/types";

interface TranslationRecord {
  owner: Node;
  field: string;
  unit: TranslationUnit;
  original: string;
  translated: string;
}

interface TextGroup {
  source: string;
  text: string;
  units: UnitSnapshot[];
  jobs: ChunkJob[];
}

interface ChunkJob { text: string; separator: string; group: TextGroup; }

interface UnitSnapshot { unit: TranslationUnit; value: string; text: string; }

const INITIAL_STATE: PageState = {
  phase: "idle",
  message: "Ready.",
  aggressive: false,
  translatedCount: 0,
  skippedCount: 0,
  canRestore: false,
  canRetry: false,
  targetLanguage: "",
  detectedLanguages: []
};

let settings: TranslatorSettings | null = null;
let diagnosticsEnabled = false;
const diagnostics = new DiagnosticBuffer();
let languages: LanguageInfo[] = [];
let state: PageState = { ...INITIAL_STATE };
let records = new Set<TranslationRecord>();
let recordsByOwner = new WeakMap<Node, Map<string, TranslationRecord>>();
const translationCache = new LruCache<string, string>();
const processedUnchanged = new ProcessedMarker();
let activeRequestIds = new Set<string>();
const requestGenerations = new Map<string, number>();
let translationActive = false;
const observers = new Map<Document | ShadowRoot, MutationObserver>();
const ownWrites = new SelfWriteTracker();
const dirtyRoots = new Set<Node>();
let fullScanRequested = false;
let firstDirtyAt = 0;
let lastScan: ScanStats & { scope: "full" | "dirty"; roots: number } = { scope: "full", roots: 0, nodesVisited: 0, pseudoStyleReads: 0 };
const workMetrics = { translationRequests: 0, cacheHits: 0 };
let mutationTimer: number | null = null;
let bannerHost: HTMLElement | null = null;
let currentRun = 0;
let settingsChangeTimer: number | null = null;
const translationRunner = new CoalescingRunner<{ aggressive: boolean; incremental: boolean }>();

function cacheKey(source: string, target: string, text: string): string {
  return `${source}\u0000${target}\u0000${text}`;
}

function languageName(code: string): string {
  return languages.find((language) => normalizeLanguageCode(language.code) === normalizeLanguageCode(code))?.name ?? code;
}

function trace(unit: TranslationUnit, outcome: DiagnosticOutcome, source: string | null, target: string, value?: string, reason?: string): void {
  if (diagnosticsEnabled) diagnostics.push(diagnosticFor(unit, outcome, source, target, value, reason));
}

const traceSkipped: UnitSkip = (outcome, kind, element, sample) => {
  diagnostics.push({
    time: Date.now(), outcome, kind,
    selector: (element.id ? `#${element.id.slice(0, 40)}` : element.tagName.toLowerCase()).slice(0, 80),
    source: null, target: settings?.targetLanguage ?? "", sample: sample.replace(/\s+/g, " ").slice(0, 80)
  });
};

function setState(patch: Partial<PageState>): void {
  state = { ...state, ...patch };
  void chrome.runtime.sendMessage({ type: "SET_BADGE", phase: state.phase } satisfies RuntimeMessage).catch(() => undefined);
  void chrome.runtime.sendMessage({ type: "PAGE_STATE_CHANGED", state }).catch(() => undefined);
}

function removeBanner(): void {
  bannerHost?.remove();
  bannerHost = null;
}

function createButton(label: string, primary = false): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = label;
  button.type = "button";
  if (primary) button.className = "primary";
  return button;
}

function showBanner(detectedLanguages: string[], sourceLanguageOverride: string | null): void {
  removeBanner();
  const host = document.createElement("div");
  host.id = EXTENSION_HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .bar { position: fixed; z-index: 2147483647; top: 14px; left: 50%; transform: translateX(-50%); width: min(720px, calc(100vw - 28px)); box-sizing: border-box; display: flex; align-items: center; gap: 14px; padding: 13px 14px; border: 1px solid #d8deea; border-radius: 13px; background: #fff; color: #182237; box-shadow: 0 16px 45px rgba(23, 34, 55, .20); font: 14px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .copy { min-width: 0; flex: 1; }
    strong { display: block; font-size: 14px; }
    span { display: block; margin-top: 2px; color: #657089; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .actions { display: flex; gap: 7px; flex-wrap: wrap; justify-content: flex-end; }
    button { all: unset; box-sizing: border-box; cursor: pointer; padding: 8px 11px; border: 1px solid #cfd6e2; border-radius: 8px; color: #263248; background: #fff; font: 650 12px/1 ui-sans-serif, system-ui, sans-serif; }
    button:hover { background: #f1f4f9; }
    button.primary { color: white; background: #485ed8; border-color: #485ed8; }
    @media (max-width: 600px) { .bar { align-items: flex-start; flex-direction: column; } .actions { width: 100%; } }
    @media (prefers-color-scheme: dark) { .bar { color: #edf1f8; background: #1b2331; border-color: #3a4558; } span { color: #adb7c9; } button { color: #edf1f8; background: #141b27; border-color: #465166; } button:hover { background: #263145; } }
  `;
  const bar = document.createElement("div");
  bar.className = "bar";
  bar.setAttribute("role", "dialog");
  bar.setAttribute("aria-label", "Page translation available");
  const copy = document.createElement("div");
  copy.className = "copy";
  const heading = document.createElement("strong");
  heading.textContent = `Translate this page to ${languageName(settings?.targetLanguage ?? "")}?`;
  const detail = document.createElement("span");
  detail.textContent = sourceLanguageOverride
    ? `Using ${languageName(sourceLanguageOverride)} as this site's selected source language. Translation runs on this device.`
    : `Detected ${detectedLanguages.map(languageName).join(", ")}. Translation runs on this device; a language model may be downloaded first.`;
  copy.append(heading, detail);
  const actions = document.createElement("div");
  actions.className = "actions";
  const translate = createButton("Translate", true);
  const always = createButton("Always for this site");
  const notNow = createButton("Not now");
  const never = createButton("Never for this site");
  translate.addEventListener("click", () => { void startTranslation(state.aggressive); });
  always.addEventListener("click", () => {
    void setAlwaysTranslate(location.hostname, true).then(() => startTranslation(state.aggressive));
  });
  notNow.addEventListener("click", () => {
    removeBanner();
    setState({ phase: "idle", message: "Translation dismissed for this page." });
  });
  never.addEventListener("click", () => {
    void setNeverTranslate(location.hostname, true).then(() => {
      removeBanner();
      setState({ phase: "idle", message: "Translation prompts disabled for this site." });
    });
  });
  actions.append(translate, always, notNow, never);
  bar.append(copy, actions);
  shadow.append(style, bar);
  (document.body ?? document.documentElement).append(host);
  bannerHost = host;
}

function existingRecord(unit: TranslationUnit): TranslationRecord | undefined {
  const record = recordsByOwner.get(unit.owner)?.get(unit.field);
  if (record && unitConnected(unit)) records.add(record);
  return record;
}

function unitConnected(unit: TranslationUnit): boolean {
  const frame = unit.document.defaultView?.frameElement;
  return unit.owner.isConnected && unit.element.isConnected && (unit.document === document || Boolean(frame?.isConnected));
}

function pruneDetachedRecords(): void {
  for (const record of [...records]) {
    if (unitConnected(record.unit)) continue;
    records.delete(record);
    if (record.field === "pseudo:before" || record.field === "pseudo:after") {
      removePseudoOverride(record.unit.element, record.field === "pseudo:before" ? "before" : "after", record.unit.root);
      removeRecord(record);
    }
  }
}

function removeRecord(record: TranslationRecord): void {
  records.delete(record);
  const ownerRecords = recordsByOwner.get(record.owner);
  ownerRecords?.delete(record.field);
}

function mergedDirtyRoots(): Node[] {
  const roots = [...dirtyRoots];
  dirtyRoots.clear();
  return roots.filter((candidate) => !roots.some((other) => other !== candidate && other.contains(candidate)));
}

function pendingUnits(aggressive: boolean, full: boolean): { units: TranslationUnit[]; observedRoots: Array<Document | ShadowRoot> } {
  const skip = diagnosticsEnabled ? traceSkipped : undefined;
  const stats: ScanStats = { nodesVisited: 0, pseudoStyleReads: 0 };
  const dirty = full ? [] : mergedDirtyRoots();
  const scanned = full
    ? { units: collectTranslationUnits(document, aggressive, skip, stats), roots: discoverAccessibleRoots(document) }
    : dirty.map((root) => collectTranslationUnitsInSubtree(root as Document | ShadowRoot | Element, aggressive, skip, stats)).reduce(
      (combined, result) => ({ units: [...combined.units, ...result.units], roots: [...combined.roots, ...result.roots] }),
      { units: [] as TranslationUnit[], roots: [] as Array<Document | ShadowRoot> }
    );
  lastScan = { ...stats, scope: full ? "full" : "dirty", roots: full ? scanned.roots.length : dirty.length };
  const seen = new WeakMap<Node, Set<string>>();
  const units = scanned.units.filter((unit) => {
    const fields = seen.get(unit.owner) ?? new Set<string>();
    if (fields.has(unit.field)) return false;
    fields.add(unit.field);
    seen.set(unit.owner, fields);
    const record = existingRecord(unit);
    if (!record) return true;
    if (unit.getValue() === record.translated) return false;
    removeRecord(record);
    return true;
  });
  return { units, observedRoots: scanned.roots };
}

function snapshotCurrent(snapshot: UnitSnapshot, runId: number, target: string): boolean {
  const { unit, value } = snapshot;
  return runId === currentRun && settings?.targetLanguage === target && unitConnected(unit)
    && unit.getValue() === value;
}

function applyTranslation(snapshot: UnitSnapshot, translatedCore: string, source: string, target: string, runId: number): boolean {
  const { unit, value: original, text } = snapshot;
  if (!snapshotCurrent(snapshot, runId, target)) { trace(unit, "stale", source, target, text); return false; }
  if (translatedCore === text) {
    processedUnchanged.mark(unit.owner, unit.field, original, source, target);
    trace(unit, "unchanged-success", source, target, text);
    return true;
  }
  unit.setTranslation(translatedCore);
  const translated = unit.getValue();
  if (translated === original) return false;
  if (unit.kind === "text-node") ownWrites.note(unit.owner, "characterData", null, original, translated);
  else if (unit.kind === "readable-attribute") ownWrites.note(unit.owner, "attributes", unit.field.slice("attribute:".length), original, translated);
  else if (unit.kind === "document-title") {
    const titleText = unit.element.firstChild;
    if (titleText?.nodeType === Node.TEXT_NODE) ownWrites.note(titleText, "characterData", null, original, translated);
  }
  const record: TranslationRecord = { owner: unit.owner, field: unit.field, unit, original, translated };
  let ownerRecords = recordsByOwner.get(unit.owner);
  if (!ownerRecords) {
    ownerRecords = new Map();
    recordsByOwner.set(unit.owner, ownerRecords);
  }
  ownerRecords.set(unit.field, record);
  records.add(record);
  trace(unit, "translated", source, target, text);
  return true;
}

function scheduleIncremental(delay = 100): void {
  if (!translationActive) return;
  if (!firstDirtyAt) firstDirtyAt = performance.now();
  if (mutationTimer !== null) window.clearTimeout(mutationTimer);
  const remaining = Math.max(0, 500 - (performance.now() - firstDirtyAt));
  mutationTimer = window.setTimeout(() => {
    mutationTimer = null;
    firstDirtyAt = 0;
    void startTranslation(state.aggressive, true);
  }, Math.min(delay, remaining));
}

function invalidatePseudo(predicate: (element: Element) => boolean): void {
  for (const record of [...records]) {
    if ((record.field === "pseudo:before" || record.field === "pseudo:after") && predicate(record.unit.element)) {
      removePseudoOverride(record.unit.element, record.field === "pseudo:before" ? "before" : "after", record.unit.root);
      removeRecord(record);
    }
  }
}

function observeDynamicContent(additionalRoots?: Array<Document | ShadowRoot>): void {
  const roots = additionalRoots ?? discoverAccessibleRoots(document);
  if (!additionalRoots) {
    for (const [root, observer] of observers) {
      if (!roots.includes(root)) { observer.disconnect(); root.removeEventListener("load", onFrameLoad, true); observers.delete(root); }
    }
  }
  for (const root of roots) {
    if (observers.has(root)) continue;
    const observer = new MutationObserver((mutations) => {
      if (!translationActive) return;
      let siteMutation = false;
      for (const mutation of mutations) {
        if (ownWrites.consume(mutation)) continue;
        const element = isElement(mutation.target) ? mutation.target : mutation.target.parentElement;
        if (element?.closest(`#${EXTENSION_HOST_ID},[data-page-translator-style]`)) continue;
        siteMutation = true;
        if (element?.tagName === "STYLE" || (element?.tagName === "LINK" && element.getAttribute("rel") === "stylesheet")) {
          invalidatePseudo(() => true);
          dirtyRoots.add(element.ownerDocument);
          continue;
        }
        if (mutation.type === "attributes" && element && ["class", "style", "hidden", "aria-hidden", "data-state", "data-open"].includes(mutation.attributeName ?? "")) {
          invalidatePseudo((candidate) => candidate === element || element.contains(candidate) || element.shadowRoot === candidate.getRootNode());
        }
        if (mutation.type === "characterData" && element?.tagName === "TITLE") dirtyRoots.add(element.ownerDocument);
        else if (mutation.type === "childList") {
          let addedElement = false;
          for (const added of mutation.addedNodes) {
            if (isElement(added)) { dirtyRoots.add(added); addedElement = true; }
            else if (added.nodeType === Node.TEXT_NODE && element) dirtyRoots.add(element);
          }
          if (mutation.removedNodes.length > 0 || !addedElement) dirtyRoots.add(mutation.target);
        } else if (mutation.target.nodeType === Node.DOCUMENT_FRAGMENT_NODE || mutation.target.nodeType === Node.DOCUMENT_NODE) dirtyRoots.add(mutation.target);
        else if (element) dirtyRoots.add(element);
      }
      pruneDetachedRecords();
      if (siteMutation) scheduleIncremental();
    });
    observer.observe(isDocument(root) ? root.documentElement : root, {
      childList: true, subtree: true, characterData: true, characterDataOldValue: true, attributes: true, attributeOldValue: true,
      attributeFilter: ["title", "alt", "placeholder", "aria-label", "class", "style", "hidden", "aria-hidden", "aria-expanded", "open", "data-state", "data-open"]
    });
    observers.set(root, observer);
    root.addEventListener("load", onFrameLoad, true);
  }
}

function onFrameLoad(event: Event): void {
  if (!translationActive || !event.target || !("nodeType" in event.target) || !isElement(event.target as Node) || (event.target as Element).tagName !== "IFRAME") return;
  dirtyRoots.add(event.target as Node);
  scheduleIncremental();
}

async function translateBatch(source: string, jobs: ChunkJob[], target: string, runId: number): Promise<{ outputs: Map<ChunkJob, string>; error?: string }> {
  const uncached: ChunkJob[] = [];
  const outputs = new Map<ChunkJob, string>();
  for (const job of jobs) {
    if (runId !== currentRun) return { outputs };
    const cached = translationCache.get(cacheKey(source, target, job.text));
    if (cached === undefined) {
      uncached.push(job);
    } else {
      workMetrics.cacheHits += 1;
      outputs.set(job, cached);
    }
  }
  if (uncached.length === 0) return { outputs };

  const requestId = crypto.randomUUID();
  workMetrics.translationRequests += 1;
  activeRequestIds.add(requestId);
  requestGenerations.set(requestId, runId);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "TRANSLATE_BATCH",
      requestId,
      source,
      target,
      texts: uncached.map((job) => job.text)
    } satisfies RuntimeMessage) as TranslationResponse;
    if (!response.ok) {
      for (const job of uncached) for (const snapshot of job.group.units) trace(snapshot.unit, response.code === "CANCELLED" ? "cancelled" : "failed", source, target, snapshot.text, response.message);
      return { outputs, error: response.message };
    }
    if (runId !== currentRun) return { outputs };
    if (!Array.isArray(response.translatedTexts) || response.translatedTexts.length !== uncached.length) return { outputs, error: `Translation returned ${Array.isArray(response.translatedTexts) ? response.translatedTexts.length : "no"} results for ${uncached.length} inputs.` };
    response.translatedTexts.forEach((text, index) => {
      const job = uncached[index]!;
      translationCache.set(cacheKey(source, target, job.text), text);
      outputs.set(job, text);
    });
    return { outputs };
  } finally {
    activeRequestIds.delete(requestId);
    requestGenerations.delete(requestId);
  }
}

function startTranslation(aggressive = false, incremental = false): Promise<void> {
  if (!incremental) {
    currentRun += 1;
    fullScanRequested = true;
    processedUnchanged.clear();
    if (activeRequestIds.size) void chrome.runtime.sendMessage({ type: "CANCEL_REQUESTS", requestIds: [...activeRequestIds] } satisfies RuntimeMessage).catch(() => undefined);
  }
  return translationRunner.run({ aggressive, incremental }, ({ aggressive: nextAggressive, incremental: nextIncremental }) =>
    runTranslation(nextAggressive, nextIncremental)
  );
}

async function runTranslation(aggressive = false, incremental = false): Promise<void> {
  if (incremental && !translationActive) return;
  if (!settings?.targetLanguage || languages.length === 0 || !canBeTarget(settings.targetLanguage, languages)) {
    setState({ phase: "setup", message: settings?.targetLanguage && languages.length > 0
      ? `The selected target ${languageName(settings.targetLanguage)} has no route in this bundled catalog. Choose another target in settings.`
      : "Choose a target language before translating." });
    return;
  }

  const runId = currentRun;
  const target = settings.targetLanguage;
  const full = fullScanRequested || !incremental;
  fullScanRequested = false;
  if (full) dirtyRoots.clear();
  removeBanner();
  const { units, observedRoots } = pendingUnits(aggressive, full);
  if (units.length === 0) {
    translationActive = true;
    observeDynamicContent(full ? undefined : observedRoots);
    setState({ phase: records.size ? "complete" : "idle", message: incremental
      ? "No new or changed translatable content was found."
      : records.size ? "Page translated." : "No translatable text found.", aggressive });
    return;
  }

  const sourceLanguageOverride = await getSourceLanguage(location.hostname);
  if (runId !== currentRun || settings.targetLanguage !== target) return;
  const classified = classifyUnitsForSite(units, languages, sourceLanguageOverride);
  const bySource = new Map<string, Map<string, UnitSnapshot[]>>();
  let skipped = 0;
  const skipReasons = { uncertain: 0, detectorUnsupported: 0, routeMissing: 0 };
  for (const { unit, sourceLanguage, reason } of classified) {
    if (!sourceLanguage) {
      trace(unit, reason === "detector-unsupported" ? "detector-unsupported" : "uncertain", null, target);
      if (reason === "detector-unsupported") skipReasons.detectorUnsupported += 1;
      else skipReasons.uncertain += 1;
      skipped += 1;
      continue;
    }
    if (normalizeLanguageCode(sourceLanguage) === normalizeLanguageCode(target)) { trace(unit, "already-target", sourceLanguage, target); continue; }
    if (processedUnchanged.has(unit.owner, unit.field, unit.getValue(), sourceLanguage, target)) continue;
    if (!supportsPair(languages, sourceLanguage, target)) {
      trace(unit, "route-missing", sourceLanguage, target);
      skipReasons.routeMissing += 1;
      skipped += 1;
      continue;
    }
    let textMap = bySource.get(sourceLanguage);
    if (!textMap) {
      textMap = new Map();
      bySource.set(sourceLanguage, textMap);
    }
    const text = unit.getText();
    const snapshot: UnitSnapshot = { unit, value: unit.getValue(), text };
    const matchingUnits = textMap.get(text) ?? [];
    matchingUnits.push(snapshot);
    textMap.set(text, matchingUnits);
  }

  const batches: Array<{ source: string; jobs: ChunkJob[] }> = [];
  const allGroups: TextGroup[] = [];
  const preparationErrors: string[] = [];
  for (const [source, textMap] of bySource) {
    const groups: TextGroup[] = [...textMap].map(([text, matchingUnits]) => ({ source, text, units: matchingUnits, jobs: [] }));
    const jobs: ChunkJob[] = [];
    for (const group of groups) {
      try {
        for (const chunk of splitText(group.text)) {
          const job: ChunkJob = { text: chunk.text, separator: chunk.separator, group };
          group.jobs.push(job);
          jobs.push(job);
        }
        allGroups.push(group);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Could not split a long text item.";
        preparationErrors.push(reason);
        skipped += group.units.length;
        for (const snapshot of group.units) trace(snapshot.unit, "failed", source, target, snapshot.text, reason);
      }
    }
    for (const batch of createBatches(jobs, (job) => job.text)) batches.push({ source, jobs: batch.items });
  }

  if (batches.length === 0) {
    translationActive = true;
    observeDynamicContent(full ? undefined : observedRoots);
    setState({
      phase: skipped ? "partial" : "complete",
      message: skipped ? `${skipped} text item${skipped === 1 ? "" : "s"} left unchanged (${skipReasons.uncertain} uncertain, ${skipReasons.detectorUnsupported} outside detector support, ${skipReasons.routeMissing} without a model route${preparationErrors.length ? ", plus an oversized grapheme" : ""}).` : "No foreign text requiring translation was found.",
      aggressive,
      targetLanguage: target,
      skippedCount: skipped,
      translatedCount: records.size,
      canRestore: records.size > 0,
      canRetry: preparationErrors.length > 0
    });
    return;
  }

  translationActive = true;
  setState({ phase: "translating", message: incremental ? "Translating new page content…" : "Translating page…", aggressive, targetLanguage: target, canRetry: false });
  observeDynamicContent(full ? undefined : observedRoots);
  const tasks = batches.map(({ source, jobs }) => () => translateBatch(source, jobs, target, runId));
  const results = await runWithConcurrency(tasks, 1);
  if (runId !== currentRun) return;
  let translated = 0;
  const errors: string[] = [...preparationErrors];
  const outputs = new Map<ChunkJob, string>();
  for (const result of results) {
    for (const [job, text] of result.outputs) outputs.set(job, text);
    if (result.error) errors.push(result.error);
  }
  for (const group of allGroups) {
    if (!group.jobs.every((job) => outputs.has(job))) { skipped += group.units.length; continue; }
    const reconstructed = joinTranslatedChunks(group.jobs, group.jobs.map((job) => outputs.get(job)!));
    for (const snapshot of group.units) if (applyTranslation(snapshot, reconstructed, group.source, target, runId)) translated += 1;
  }
  const partial = skipped > 0 || errors.length > 0;
  const uniqueError = [...new Set(errors)][0];
  setState({
    phase: partial ? (records.size ? "partial" : errors.length ? "failed" : "partial") : "complete",
    message: partial
      ? `${records.size} item${records.size === 1 ? "" : "s"} translated; ${skipped} skipped.${uniqueError ? ` ${uniqueError}` : ""}`
      : `Translated ${records.size} text item${records.size === 1 ? "" : "s"}.`,
    aggressive,
    targetLanguage: target,
    translatedCount: records.size,
    skippedCount: skipped,
    canRestore: records.size > 0,
    canRetry: errors.length > 0
  });
}

async function restorePage(reevaluate = false): Promise<void> {
  const wasActive = activeRequestIds.size > 0;
  currentRun += 1;
  translationActive = false;
  fullScanRequested = false;
  dirtyRoots.clear();
  ownWrites.clear();
  firstDirtyAt = 0;
  for (const [root, observer] of observers) { observer.disconnect(); root.removeEventListener("load", onFrameLoad, true); }
  observers.clear();
  if (mutationTimer !== null) window.clearTimeout(mutationTimer);
  mutationTimer = null;
  if (activeRequestIds.size) {
    await chrome.runtime.sendMessage({ type: "CANCEL_REQUESTS", requestIds: [...activeRequestIds] } satisfies RuntimeMessage).catch(() => undefined);
    activeRequestIds.clear();
  }
  pruneDetachedRecords();
  for (const record of records) {
    restoreIfUnchanged(record.unit, record.original, record.translated);
  }
  records.clear();
  recordsByOwner = new WeakMap();
  setState({
    phase: wasActive ? "cancelled" : "idle",
    message: wasActive ? "Translation cancelled; original page text restored." : "Original page text restored.",
    translatedCount: 0,
    skippedCount: 0,
    canRestore: false,
    canRetry: false
  });
  if (reevaluate) await evaluatePage();
}

async function evaluatePage(): Promise<void> {
  removeBanner();
  diagnosticsEnabled = (await chrome.storage.local.get("developerDiagnostics")).developerDiagnostics === true;
  settings = await getSettings();
  languages = await getLanguageCatalog();
  const info = await chrome.runtime.sendMessage({ type: "GET_ENGINE_INFO" } satisfies RuntimeMessage).catch(() => null) as
    | { ok: true; settings: TranslatorSettings; languages: LanguageInfo[] }
    | null;
  if (info?.ok) { settings = info.settings; languages = info.languages; }
  if (!settings?.targetLanguage || languages.length === 0) {
    setState({ ...INITIAL_STATE, phase: "setup", message: "Choose a target language in extension settings." });
    return;
  }
  if (!canBeTarget(settings.targetLanguage, languages)) {
    setState({ ...INITIAL_STATE, phase: "setup", targetLanguage: settings.targetLanguage, message: `The selected target ${languageName(settings.targetLanguage)} has no route in this bundled catalog. Choose another target in settings.` });
    return;
  }
  if (await isNeverTranslate(location.hostname)) {
    setState({ ...INITIAL_STATE, targetLanguage: settings.targetLanguage, message: "Translation prompts are disabled for this site." });
    return;
  }

  const sourceLanguageOverride = await getSourceLanguage(location.hostname);
  setState({
    phase: "detecting",
    message: sourceLanguageOverride ? `Using ${languageName(sourceLanguageOverride)} as the selected source language…` : "Detecting page languages locally…",
    targetLanguage: settings.targetLanguage
  });
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  if (sourceLanguageOverride && normalizeLanguageCode(sourceLanguageOverride) === normalizeLanguageCode(settings.targetLanguage)) {
    setState({
      phase: "idle",
      message: "The selected source and target languages are the same.",
      detectedLanguages: [sourceLanguageOverride]
    });
    return;
  }
  if (sourceLanguageOverride && !supportsPair(languages, sourceLanguageOverride, settings.targetLanguage)) {
      setState({
        phase: "setup",
      message: `${languageName(sourceLanguageOverride)} → ${languageName(settings.targetLanguage)} is not available. Choose another source language or Auto-detect.`,
      detectedLanguages: [sourceLanguageOverride]
    });
    return;
  }
  const classified = classifyUnitsForSite(collectTranslationUnits(document, false, diagnosticsEnabled ? traceSkipped : undefined), languages, sourceLanguageOverride);
  const detectedLanguages = [...new Set(classified.map(({ sourceLanguage }) => sourceLanguage).filter((code): code is string => Boolean(code)))]
    .filter((code) => normalizeLanguageCode(code) !== normalizeLanguageCode(settings!.targetLanguage));
  if (shouldPrompt(classified.filter(({ sourceLanguage }) => sourceLanguage !== null && supportsPair(languages, sourceLanguage, settings!.targetLanguage)), settings.targetLanguage)) {
    if (await isAlwaysTranslate(location.hostname)) {
      setState({ phase: "translating", message: "Automatically translating this site…", detectedLanguages });
      await startTranslation(false);
    } else {
      showBanner(detectedLanguages, sourceLanguageOverride);
      setState({ phase: "prompt", message: `Translation available from ${detectedLanguages.map(languageName).join(", ")}.`, detectedLanguages });
    }
  } else {
    setState({
      phase: "idle",
      message: sourceLanguageOverride && normalizeLanguageCode(sourceLanguageOverride) === normalizeLanguageCode(settings.targetLanguage)
        ? "The selected source and target languages are the same."
        : sourceLanguageOverride
          ? `No eligible text was found to translate from ${languageName(sourceLanguageOverride)}.`
          : "No confident foreign-language content was detected.",
      detectedLanguages
    });
  }
}

async function handlePageMessage(message: RuntimeMessage): Promise<unknown> {
  switch (message.type) {
    case "GET_PAGE_STATE":
      return state;
    case "GET_DIAGNOSTICS":
      return { enabled: diagnosticsEnabled, entries: diagnosticsEnabled ? diagnostics.list() : [], lastScan, metrics: { ...workMetrics, cacheEntries: translationCache.size, cacheCharacters: translationCache.characterCount, recordCount: records.size } };
    case "TRANSLATE_PAGE":
      await startTranslation(message.aggressive ?? state.aggressive);
      return state;
    case "TRANSLATE_NEW_CONTENT":
      if (!translationActive) {
        setState({ message: "Translate the page first to watch for new content." });
        return state;
      }
      if (dirtyRoots.size === 0) {
        setState({ message: "No new or changed content is pending." });
        return state;
      }
      await startTranslation(state.aggressive, true);
      return state;
    case "RESTORE_PAGE":
      await restorePage(false);
      return state;
    case "SET_AGGRESSIVE":
      if (translationActive && !message.enabled) {
        await restorePage(false);
        await startTranslation(false);
      } else if (message.enabled) {
        await startTranslation(true);
      } else {
        setState({ aggressive: false });
      }
      return state;
    case "RETRY_TRANSLATION":
      await startTranslation(state.aggressive);
      return state;
    case "PREFERENCES_CHANGED":
      if (message.sourceChanged) currentRun += 1;
      if (await isNeverTranslate(location.hostname)) {
        if (!message.sourceChanged) currentRun += 1;
        if (translationActive) await restorePage(false);
        removeBanner();
        setState({ phase: "idle", message: "Translation prompts are disabled for this site." });
      } else if (message.sourceChanged) {
        if (translationActive) await restorePage(false);
        await evaluatePage();
      } else if (!translationActive) {
        await evaluatePage();
      }
      return state;
    case "ENGINE_PROGRESS_FOR_PAGE":
      if (requestGenerations.get(message.requestId) === currentRun) setState({ phase: message.phase, message: message.message });
      return state;
    default:
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  void handlePageMessage(message).then(sendResponse).catch((error: unknown) => {
    setState({ phase: "failed", message: error instanceof Error ? error.message : "Unexpected page translation error.", canRetry: true });
    sendResponse(state);
  });
  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.developerDiagnostics) {
    diagnosticsEnabled = changes.developerDiagnostics.newValue === true;
    if (!diagnosticsEnabled) diagnostics.clear();
  }
  if (areaName !== "local" || (!changes.translatorSettings && !changes.languageCatalog)) return;
  currentRun += 1;
  if (settingsChangeTimer !== null) window.clearTimeout(settingsChangeTimer);
  settingsChangeTimer = window.setTimeout(() => {
    settingsChangeTimer = null;
    const wasActive = translationActive;
    const aggressive = state.aggressive;
    void (async () => {
      if (wasActive) {
        await restorePage(false);
        settings = await getSettings();
        languages = await getLanguageCatalog();
        await startTranslation(aggressive);
      } else {
        await evaluatePage();
      }
    })();
  }, 50);
});

window.addEventListener("pagehide", () => {
  currentRun += 1;
  translationActive = false;
  if (activeRequestIds.size) void chrome.runtime.sendMessage({ type: "CANCEL_REQUESTS", requestIds: [...activeRequestIds] } satisfies RuntimeMessage);
});

void evaluatePage();
