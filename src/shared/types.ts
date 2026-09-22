export interface LanguageInfo {
  code: string;
  name: string;
  targets: string[];
}

export interface TranslatorSettings {
  targetLanguage: string;
}

export interface SitePreference {
  neverTranslate?: boolean;
  alwaysTranslate?: boolean;
  sourceLanguage?: string;
}

export type SitePreferences = Record<string, SitePreference>;

export type PagePhase =
  | "idle"
  | "setup"
  | "detecting"
  | "downloading"
  | "verifying"
  | "loading"
  | "pivoting"
  | "prompt"
  | "translating"
  | "complete"
  | "partial"
  | "cancelled"
  | "failed";

export interface PageState {
  phase: PagePhase;
  message: string;
  aggressive: boolean;
  translatedCount: number;
  skippedCount: number;
  canRestore: boolean;
  canRetry: boolean;
  targetLanguage: string;
  detectedLanguages: string[];
}

export interface TranslationRequest {
  type: "TRANSLATE_BATCH";
  requestId: string;
  source: string;
  target: string;
  texts: string[];
}

export interface TranslationSuccess {
  ok: true;
  translatedTexts: string[];
  memory?: {
    wasmHeapBytes: number;
    peakWasmHeapBytes: number;
  };
}

export interface ExtensionFailure {
  ok: false;
  code: string;
  message: string;
  status?: number;
}

export type TranslationResponse = TranslationSuccess | ExtensionFailure;

export type RuntimeMessage =
  | TranslationRequest
  | { type: "CANCEL_REQUESTS"; requestIds: string[] }
  | { type: "GET_ENGINE_INFO" }
  | { type: "CLEAR_MODEL_CACHE" }
  | { type: "ENGINE_TRANSLATE"; targetContext: "offscreen"; requestId: string; source: string; target: string; texts: string[] }
  | { type: "ENGINE_CANCEL"; targetContext: "offscreen"; requestIds: string[] }
  | { type: "ENGINE_PROGRESS"; targetContext: "background"; requestId: string; phase: PagePhase; message: string }
  | { type: "ENGINE_IDLE"; targetContext: "background" }
  | { type: "ENGINE_PROGRESS_FOR_PAGE"; requestId: string; phase: PagePhase; message: string }
  | { type: "SET_BADGE"; phase: PagePhase; tabId?: number }
  | { type: "GET_PAGE_STATE" }
  | { type: "GET_DIAGNOSTICS" }
  | { type: "TRANSLATE_PAGE"; aggressive?: boolean }
  | { type: "RESTORE_PAGE" }
  | { type: "SET_AGGRESSIVE"; enabled: boolean }
  | { type: "RETRY_TRANSLATION" }
  | { type: "PREFERENCES_CHANGED"; sourceChanged?: boolean };
