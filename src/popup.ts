import "./ui.css";
import { canBeTarget, normalizeLanguageCode, supportsPair } from "./shared/languages";
import { getLanguageCatalog, getSettings, getSourceLanguage, isAlwaysTranslate, isNeverTranslate, saveSettings, setAlwaysTranslate, setNeverTranslate, setSourceLanguage } from "./shared/storage";
import type { LanguageInfo, PageState, RuntimeMessage } from "./shared/types";
import { pageActionAvailability } from "./shared/page-actions";

const statusText = document.querySelector<HTMLElement>("#status")!;
const statusDot = document.querySelector<HTMLElement>("#status-dot")!;
const targetSelect = document.querySelector<HTMLSelectElement>("#target-language")!;
const sourceSelect = document.querySelector<HTMLSelectElement>("#source-language")!;
const translateButton = document.querySelector<HTMLButtonElement>("#translate")!;
const restoreButton = document.querySelector<HTMLButtonElement>("#restore")!;
const cancelButton = document.querySelector<HTMLButtonElement>("#cancel")!;
const retryButton = document.querySelector<HTMLButtonElement>("#retry")!;
const aggressiveToggle = document.querySelector<HTMLInputElement>("#aggressive")!;
const alwaysSiteToggle = document.querySelector<HTMLInputElement>("#always-site")!;
const neverSiteToggle = document.querySelector<HTMLInputElement>("#never-site")!;
const hostnameLabel = document.querySelector<HTMLElement>("#hostname")!;
const settingsButton = document.querySelector<HTMLButtonElement>("#settings")!;

let activeTabId: number | null = null;
let hostname = "";
let settings = await getSettings();
let languages: LanguageInfo[] = await getLanguageCatalog();
let state: PageState | null = null;
let sourceLanguage: string | null = null;

const info = await chrome.runtime.sendMessage({ type: "GET_ENGINE_INFO" } satisfies RuntimeMessage).catch(() => null) as
  | { ok: true; settings: typeof settings; languages: LanguageInfo[] }
  | null;
if (info?.ok) {
  settings = info.settings;
  languages = info.languages;
}

function fillLanguages(): void {
  targetSelect.replaceChildren(new Option("Choose a language", ""));
  for (const language of languages) {
    if (canBeTarget(language.code, languages)) targetSelect.add(new Option(language.name, language.code));
  }
  if (settings?.targetLanguage && !canBeTarget(settings.targetLanguage, languages)) {
    const option = new Option(`${settings.targetLanguage} (unavailable)`, settings.targetLanguage);
    option.disabled = true;
    targetSelect.add(option);
  }
  targetSelect.value = settings?.targetLanguage ?? "";
  targetSelect.disabled = !settings || languages.length === 0;

  sourceSelect.replaceChildren(new Option("Auto-detect", ""));
  for (const language of languages) {
    const selected = sourceLanguage && normalizeLanguageCode(language.code) === normalizeLanguageCode(sourceLanguage);
    if (selected || (settings?.targetLanguage && supportsPair(languages, language.code, settings.targetLanguage))) {
      sourceSelect.add(new Option(language.name, language.code));
    }
  }
  const selectedSource = sourceLanguage;
  if (selectedSource && !languages.some((language) => normalizeLanguageCode(language.code) === normalizeLanguageCode(selectedSource ?? undefined))) {
    const option = new Option(`${selectedSource} (unavailable)`, selectedSource);
    option.disabled = true;
    sourceSelect.add(option);
  }
  sourceSelect.value = sourceLanguage ?? "";
  sourceSelect.disabled = !hostname || languages.length === 0;
}

function render(): void {
  const phase = state?.phase ?? (settings ? "idle" : "setup");
  statusText.textContent = state?.message ?? (settings ? "Open a regular web page to translate it." : "Choose a target language to begin.");
  const busy = ["detecting", "downloading", "verifying", "loading", "pivoting", "translating"].includes(phase);
  statusDot.dataset.tone = phase === "failed" ? "error" : busy ? "busy" : phase === "complete" ? "ok" : "";
  translateButton.disabled = !settings || !activeTabId || busy || phase === "setup";
  const actions = pageActionAvailability(phase, state?.canRestore ?? false, activeTabId !== null);
  restoreButton.disabled = !actions.restore || busy;
  restoreButton.hidden = !actions.restore;
  cancelButton.hidden = !actions.cancel;
  cancelButton.disabled = !actions.cancel;
  retryButton.hidden = !state?.canRetry;
  aggressiveToggle.disabled = !settings || !activeTabId || busy;
  aggressiveToggle.checked = state?.aggressive ?? false;
  sourceSelect.disabled = !hostname || languages.length === 0 || busy;
}

async function sendToPage(message: RuntimeMessage): Promise<unknown> {
  if (activeTabId === null) return null;
  try {
    return await chrome.tabs.sendMessage(activeTabId, message);
  } catch {
    return null;
  }
}

async function refreshState(): Promise<void> {
  const response = await sendToPage({ type: "GET_PAGE_STATE" });
  state = response && typeof response === "object" && "phase" in response ? response as PageState : null;
  render();
}

const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
if (activeTab?.id !== undefined) {
  activeTabId = activeTab.id;
  try {
    const url = activeTab.url ? new URL(activeTab.url) : null;
    hostname = url?.hostname ?? "";
  } catch {
    hostname = "";
  }
}
hostnameLabel.textContent = hostname || "This page is not supported";
neverSiteToggle.disabled = !hostname;
alwaysSiteToggle.disabled = !hostname;
if (hostname) {
  [alwaysSiteToggle.checked, neverSiteToggle.checked, sourceLanguage] = await Promise.all([
    isAlwaysTranslate(hostname),
    isNeverTranslate(hostname),
    getSourceLanguage(hostname)
  ]);
}
fillLanguages();
await refreshState();

translateButton.addEventListener("click", async () => {
  await sendToPage({ type: "TRANSLATE_PAGE", aggressive: aggressiveToggle.checked });
  await refreshState();
});

restoreButton.addEventListener("click", async () => {
  await sendToPage({ type: "RESTORE_PAGE" });
  await refreshState();
});

cancelButton.addEventListener("click", async () => {
  if (state) {
    state = { ...state, phase: "cancelled", message: "Cancelling translation and restoring original text…", canRestore: false, canRetry: false };
    render();
  }
  await sendToPage({ type: "RESTORE_PAGE" });
  await refreshState();
});

retryButton.addEventListener("click", async () => {
  await sendToPage({ type: "RETRY_TRANSLATION" });
  await refreshState();
});

aggressiveToggle.addEventListener("change", async () => {
  if (aggressiveToggle.checked) {
    const confirmed = confirm("Aggressive mode includes hidden, code-like, and normally skipped page text. It can alter page layout or script-managed interfaces. Continue?");
    if (!confirmed) {
      aggressiveToggle.checked = false;
      return;
    }
  }
  await sendToPage({ type: "SET_AGGRESSIVE", enabled: aggressiveToggle.checked });
  await refreshState();
});

neverSiteToggle.addEventListener("change", async () => {
  if (!hostname) return;
  await setNeverTranslate(hostname, neverSiteToggle.checked);
  if (neverSiteToggle.checked) alwaysSiteToggle.checked = false;
  await sendToPage({ type: "PREFERENCES_CHANGED" });
  await refreshState();
});

alwaysSiteToggle.addEventListener("change", async () => {
  if (!hostname) return;
  await setAlwaysTranslate(hostname, alwaysSiteToggle.checked);
  if (alwaysSiteToggle.checked) neverSiteToggle.checked = false;
  await sendToPage({ type: "PREFERENCES_CHANGED" });
  await refreshState();
});

targetSelect.addEventListener("change", async () => {
  if (!settings || !targetSelect.value || !canBeTarget(targetSelect.value, languages)) return;
  settings = { ...settings, targetLanguage: targetSelect.value };
  await saveSettings(settings);
  fillLanguages();
  await refreshState();
});

sourceSelect.addEventListener("change", async () => {
  if (!hostname) return;
  sourceLanguage = sourceSelect.value || null;
  await setSourceLanguage(hostname, sourceLanguage);
  await sendToPage({ type: "PREFERENCES_CHANGED", sourceChanged: true });
  await refreshState();
});

settingsButton.addEventListener("click", () => { void chrome.runtime.openOptionsPage(); });

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (message && typeof message === "object" && (message as Record<string, unknown>).type === "PAGE_STATE_CHANGED") {
    void refreshState();
  }
});
