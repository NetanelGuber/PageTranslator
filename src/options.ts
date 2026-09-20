import "./ui.css";
import { canBeTarget, chooseDefaultTarget } from "./shared/languages";
import { getLanguageCatalog, getSettings, saveSettings } from "./shared/storage";
import type { LanguageInfo, RuntimeMessage, TranslatorSettings } from "./shared/types";

const targetSelect = document.querySelector<HTMLSelectElement>("#target-language")!;
const saveButton = document.querySelector<HTMLButtonElement>("#save")!;
const clearButton = document.querySelector<HTMLButtonElement>("#clear-models")!;
const result = document.querySelector<HTMLElement>("#settings-result")!;
const form = document.querySelector<HTMLFormElement>("#settings-form")!;

let settings: TranslatorSettings | null = await getSettings();
let languages: LanguageInfo[] = await getLanguageCatalog();

async function initialize(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: "GET_ENGINE_INFO" } satisfies RuntimeMessage) as
    { ok: boolean; settings?: TranslatorSettings; languages?: LanguageInfo[] };
  if (response.ok) {
    settings = response.settings ?? settings;
    languages = response.languages ?? languages;
  }
  targetSelect.replaceChildren(new Option("Choose a language", ""));
  for (const language of languages) {
    if (canBeTarget(language.code, languages)) targetSelect.add(new Option(language.name, language.code));
  }
  if (settings?.targetLanguage && !canBeTarget(settings.targetLanguage, languages)) {
    const option = new Option(`${settings.targetLanguage} (unavailable)`, settings.targetLanguage);
    option.disabled = true;
    targetSelect.add(option);
  }
  targetSelect.value = settings?.targetLanguage || chooseDefaultTarget(languages) || "en";
  targetSelect.disabled = languages.length === 0;
  saveButton.disabled = !targetSelect.value || !canBeTarget(targetSelect.value, languages);
}

targetSelect.addEventListener("change", () => { saveButton.disabled = !targetSelect.value || !canBeTarget(targetSelect.value, languages); });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!targetSelect.value) return;
  await saveSettings({ targetLanguage: targetSelect.value });
  settings = { targetLanguage: targetSelect.value };
  result.textContent = "Settings saved.";
  result.dataset.tone = "ok";
});

clearButton.addEventListener("click", async () => {
  clearButton.disabled = true;
  result.textContent = "Clearing downloaded models…";
  result.dataset.tone = "";
  try {
    await chrome.runtime.sendMessage({ type: "CLEAR_MODEL_CACHE" } satisfies RuntimeMessage);
    result.textContent = "Downloaded language models cleared. They will download again when needed.";
    result.dataset.tone = "ok";
  } catch (error) {
    result.textContent = error instanceof Error ? error.message : "Could not clear downloaded models.";
    result.dataset.tone = "error";
  } finally {
    clearButton.disabled = false;
  }
});

void initialize().catch((error: unknown) => {
  result.textContent = error instanceof Error ? error.message : "Could not initialize translation settings.";
  result.dataset.tone = "error";
});
