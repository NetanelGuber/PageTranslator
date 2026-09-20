import { chooseDefaultTarget } from "./shared/languages";
import { createLanguageCatalog, releasePairs, type ModelRegistry } from "./shared/model-registry";
import { getLanguageCatalog, getLanguageCatalogVersion, getSettings, saveLanguageCatalog, saveSettings } from "./shared/storage";
import type { ExtensionFailure, PagePhase, RuntimeMessage, TranslationResponse } from "./shared/types";

const OFFSCREEN_PATH = "offscreen.html";
const MODEL_CACHE = "page-translator-models-v1";
let creatingOffscreen: Promise<void> | null = null;
const requestTabs = new Map<string, number>();

const badgeByPhase: Record<PagePhase, { text: string; color: string }> = {
  idle: { text: "", color: "#64748b" }, setup: { text: "SET", color: "#64748b" },
    detecting: { text: "…", color: "#d78500" }, downloading: { text: "↓", color: "#d78500" },
    verifying: { text: "…", color: "#d78500" }, loading: { text: "…", color: "#d78500" },
    pivoting: { text: "…", color: "#d78500" }, prompt: { text: "?", color: "#485ed8" },
    translating: { text: "…", color: "#d78500" }, complete: { text: "✓", color: "#16875b" },
    partial: { text: "!", color: "#d78500" }, cancelled: { text: "", color: "#64748b" }, failed: { text: "!", color: "#c73939" }
};

function failure(code: string, message: string): ExtensionFailure { return { ok: false, code, message }; }

async function loadBundledCatalog() {
  const response = await fetch(chrome.runtime.getURL("models.json"));
  if (!response.ok) throw new Error("The bundled model catalog is unavailable.");
  const registry = await response.json() as ModelRegistry;
  return { version: registry.generated, languages: createLanguageCatalog(releasePairs(registry)) };
}

let initializingSettings: Promise<void> | null = null;
function initializeSettings(): Promise<void> {
  initializingSettings ??= (async () => {
    const bundled = await loadBundledCatalog();
    const [savedLanguages, savedVersion] = await Promise.all([getLanguageCatalog(), getLanguageCatalogVersion()]);
    if (savedVersion !== bundled.version || JSON.stringify(savedLanguages) !== JSON.stringify(bundled.languages)) {
      await saveLanguageCatalog(bundled.languages, bundled.version);
    }
    if (!await getSettings()) {
      await saveSettings({ targetLanguage: chooseDefaultTarget(bundled.languages, chrome.i18n.getUILanguage()) || "en" });
    }
  })().finally(() => { initializingSettings = null; });
  return initializingSettings;
}

async function hasOffscreenDocument(): Promise<boolean> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url]
    });
    return contexts.length > 0;
  }
  const workerGlobal = self as unknown as { clients: { matchAll(): Promise<Array<{ url: string }>> } };
  const clients = await workerGlobal.clients.matchAll();
  return clients.some((client) => client.url === url);
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  creatingOffscreen ??= chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Run the bundled WebAssembly translation engine in one shared worker."
  }).finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}

async function closeOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) await chrome.offscreen.closeDocument();
}

async function translateBatch(message: Extract<RuntimeMessage, { type: "TRANSLATE_BATCH" }>, tabId?: number): Promise<TranslationResponse> {
  if (message.texts.length === 0 || message.texts.length > 50 || message.texts.reduce((sum, text) => sum + text.length, 0) > 4000) {
    return failure("LIMIT", "A translation request exceeded the 50-item or 4,000-character input limit.");
  }
  if (tabId !== undefined) requestTabs.set(message.requestId, tabId);
  try {
    await ensureOffscreenDocument();
    return await chrome.runtime.sendMessage({
      type: "ENGINE_TRANSLATE", targetContext: "offscreen", requestId: message.requestId,
      source: message.source, target: message.target, texts: message.texts
    } satisfies RuntimeMessage) as TranslationResponse;
  } catch (error) {
    return failure("ENGINE", error instanceof Error ? error.message : "The on-device translation engine could not start.");
  } finally {
    requestTabs.delete(message.requestId);
  }
}

async function handleMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case "GET_ENGINE_INFO":
      await initializeSettings();
      return { ok: true, languages: await getLanguageCatalog(), settings: await getSettings() };
    case "CLEAR_MODEL_CACHE":
      await closeOffscreenDocument();
      return { ok: await caches.delete(MODEL_CACHE) };
    case "TRANSLATE_BATCH": return translateBatch(message, sender.tab?.id);
    case "CANCEL_REQUESTS":
      if (await hasOffscreenDocument()) {
        await chrome.runtime.sendMessage({ type: "ENGINE_CANCEL", targetContext: "offscreen", requestIds: message.requestIds } satisfies RuntimeMessage);
      }
      message.requestIds.forEach((id) => requestTabs.delete(id));
      return { ok: true };
    case "ENGINE_PROGRESS": {
      const tabId = requestTabs.get(message.requestId);
      if (tabId !== undefined) {
          await chrome.tabs.sendMessage(tabId, { type: "ENGINE_PROGRESS_FOR_PAGE", requestId: message.requestId, phase: message.phase, message: message.message } satisfies RuntimeMessage).catch(() => undefined);
      }
      return { ok: true };
    }
    case "ENGINE_IDLE":
      if (requestTabs.size === 0) await closeOffscreenDocument();
      return { ok: true };
    case "SET_BADGE": {
      const tabId = message.tabId ?? sender.tab?.id;
      if (tabId === undefined) return { ok: false };
      const badge = badgeByPhase[message.phase];
      await chrome.action.setBadgeText({ tabId, text: badge.text });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
      return { ok: true };
    }
    default: return undefined;
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  void initializeSettings().then(() => details.reason === "install" ? chrome.runtime.openOptionsPage() : undefined);
});
chrome.runtime.onStartup.addListener(() => { void initializeSettings(); });

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if ("targetContext" in message && message.targetContext === "offscreen") return false;
  void handleMessage(message, sender).then(sendResponse).catch((error: unknown) => {
    sendResponse(failure("INTERNAL", error instanceof Error ? error.message : "Unexpected extension error."));
  });
  return true;
});
