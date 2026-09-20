import type { LanguageInfo } from "./types";

export function normalizeLanguageCode(code: string): string {
  const clean = code.trim().replaceAll("_", "-");
  if (!clean) return "";
  try {
    const [normalized] = Intl.getCanonicalLocales(clean);
    return normalized ?? clean.toLowerCase();
  } catch {
    return clean.toLowerCase();
  }
}

export function resolveSupportedCode(code: string, languages: LanguageInfo[]): string | null {
  const normalized = normalizeLanguageCode(code);
  const exact = languages.find(
    (language) => normalizeLanguageCode(language.code).toLowerCase() === normalized.toLowerCase()
  );
  if (exact) return exact.code;

  const primary = normalized.split("-")[0]?.toLowerCase();
  if (!primary) return null;
  const primaryMatch = languages.find(
    (language) => normalizeLanguageCode(language.code).split("-")[0]?.toLowerCase() === primary
  );
  return primaryMatch?.code ?? null;
}

export function supportsPair(languages: LanguageInfo[], source: string, target: string): boolean {
  const sourceInfo = languages.find(
    (language) => normalizeLanguageCode(language.code).toLowerCase() === normalizeLanguageCode(source).toLowerCase()
  );
  return (
    sourceInfo?.targets.some(
      (candidate) => normalizeLanguageCode(candidate).toLowerCase() === normalizeLanguageCode(target).toLowerCase()
    ) ?? false
  );
}

export function chooseDefaultTarget(languages: LanguageInfo[], preferred = navigator.language): string {
  const targetCodes = new Set(languages.flatMap((language) => language.targets).map(normalizeLanguageCode));
  return resolveSupportedCode(preferred, languages.filter((language) => targetCodes.has(normalizeLanguageCode(language.code)))) ?? "";
}

export function canBeTarget(code: string, languages: LanguageInfo[]): boolean {
  const normalized = normalizeLanguageCode(code);
  return languages.some((language) => language.targets.some((target) => normalizeLanguageCode(target) === normalized));
}
