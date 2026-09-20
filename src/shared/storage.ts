import type { LanguageInfo, SitePreferences, TranslatorSettings } from "./types";

const SETTINGS_KEY = "translatorSettings";
const LANGUAGES_KEY = "languageCatalog";
const CATALOG_VERSION_KEY = "languageCatalogVersion";
const SITE_PREFERENCES_KEY = "sitePreferences";

export async function getSettings(): Promise<TranslatorSettings | null> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return (result[SETTINGS_KEY] as TranslatorSettings | undefined) ?? null;
}

export async function saveSettings(settings: TranslatorSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getLanguageCatalog(): Promise<LanguageInfo[]> {
  const result = await chrome.storage.local.get(LANGUAGES_KEY);
  return (result[LANGUAGES_KEY] as LanguageInfo[] | undefined) ?? [];
}

export async function getLanguageCatalogVersion(): Promise<string | null> {
  const result = await chrome.storage.local.get(CATALOG_VERSION_KEY);
  return (result[CATALOG_VERSION_KEY] as string | undefined) ?? null;
}

export async function saveLanguageCatalog(languages: LanguageInfo[], version?: string): Promise<void> {
  await chrome.storage.local.set({ [LANGUAGES_KEY]: languages, ...(version ? { [CATALOG_VERSION_KEY]: version } : {}) });
}

export async function getSitePreferences(): Promise<SitePreferences> {
  const result = await chrome.storage.local.get(SITE_PREFERENCES_KEY);
  return (result[SITE_PREFERENCES_KEY] as SitePreferences | undefined) ?? {};
}

export async function setNeverTranslate(hostname: string, neverTranslate: boolean): Promise<void> {
  const preferences = await getSitePreferences();
  if (neverTranslate) {
    preferences[hostname] = { ...preferences[hostname], neverTranslate: true, alwaysTranslate: false };
  } else {
    const preference = preferences[hostname];
    if (preference) {
      delete preference.neverTranslate;
      if (!preference.alwaysTranslate && !preference.sourceLanguage) delete preferences[hostname];
    }
  }
  await chrome.storage.local.set({ [SITE_PREFERENCES_KEY]: preferences });
}

export async function isNeverTranslate(hostname: string): Promise<boolean> {
  const preferences = await getSitePreferences();
  return preferences[hostname]?.neverTranslate === true;
}

export async function setAlwaysTranslate(hostname: string, alwaysTranslate: boolean): Promise<void> {
  const preferences = await getSitePreferences();
  if (alwaysTranslate) {
    preferences[hostname] = { ...preferences[hostname], alwaysTranslate: true, neverTranslate: false };
  } else {
    const preference = preferences[hostname];
    if (preference) {
      delete preference.alwaysTranslate;
      if (!preference.neverTranslate && !preference.sourceLanguage) delete preferences[hostname];
    }
  }
  await chrome.storage.local.set({ [SITE_PREFERENCES_KEY]: preferences });
}

export async function isAlwaysTranslate(hostname: string): Promise<boolean> {
  const preferences = await getSitePreferences();
  return preferences[hostname]?.alwaysTranslate === true;
}

export async function setSourceLanguage(hostname: string, sourceLanguage: string | null): Promise<void> {
  const preferences = await getSitePreferences();
  const preference = preferences[hostname] ?? {};
  if (sourceLanguage) {
    preferences[hostname] = { ...preference, sourceLanguage };
  } else {
    delete preference.sourceLanguage;
    if (!preference.alwaysTranslate && !preference.neverTranslate) delete preferences[hostname];
    else preferences[hostname] = preference;
  }
  await chrome.storage.local.set({ [SITE_PREFERENCES_KEY]: preferences });
}

export async function getSourceLanguage(hostname: string): Promise<string | null> {
  const preferences = await getSitePreferences();
  return preferences[hostname]?.sourceLanguage ?? null;
}
