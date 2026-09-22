import { detectAll, supportedLanguages, toISO2 } from "tinyld";
import type { LanguageInfo } from "./types";
import { closestDeclaredLanguage, getBlockText, type TranslationUnit } from "./dom";
import { normalizeLanguageCode } from "./languages";

export type DetectionState = "detected" | "uncertain" | "unsupported";
export interface DetectionResult {
  state: DetectionState;
  language: string | null;
  score?: number;
  marginRatio?: number;
}

export interface ClassifiedUnit {
  unit: TranslationUnit;
  sourceLanguage: string | null;
  reason: "override" | "own" | "element-lang" | "block" | "page-lang" | "page" | "uncertain" | "detector-unsupported";
}

type Script = "Latin" | "Arabic" | "Hebrew" | "Cyrillic" | "Han" | "Kana" | "Hangul" | "Devanagari";
const detectorCodes = [...new Set(supportedLanguages.map((code) => toISO2(code)).filter((code): code is string => Boolean(code)))];
const technicalLabel = /^(?:HD|4K|IMDb|TV|FPS)$/iu;

function primary(code: string): string { return normalizeLanguageCode(code).split("-")[0]!.toLowerCase(); }
function letterCount(value: string): number { return Array.from(value.matchAll(/\p{L}/gu)).length; }

function scriptOf(char: string): Script | null {
  if (/\p{Script=Latin}/u.test(char)) return "Latin";
  if (/\p{Script=Arabic}/u.test(char)) return "Arabic";
  if (/\p{Script=Hebrew}/u.test(char)) return "Hebrew";
  if (/\p{Script=Cyrillic}/u.test(char)) return "Cyrillic";
  if (/\p{Script=Han}/u.test(char)) return "Han";
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(char)) return "Kana";
  if (/\p{Script=Hangul}/u.test(char)) return "Hangul";
  if (/\p{Script=Devanagari}/u.test(char)) return "Devanagari";
  return null;
}

export function scriptsIn(text: string): Map<Script, number> {
  const counts = new Map<Script, number>();
  for (const char of text) {
    const script = scriptOf(char);
    if (script) counts.set(script, (counts.get(script) ?? 0) + 1);
  }
  return counts;
}

function expectedScripts(code: string): Set<Script> | null {
  const lang = primary(code);
  if (["ar", "fa", "ur", "ps"].includes(lang)) return new Set(["Arabic"]);
  if (["he", "yi"].includes(lang)) return new Set(["Hebrew"]);
  if (["ru", "uk", "bg", "be", "mk", "kk", "mn", "tt"].includes(lang)) return new Set(["Cyrillic"]);
  if (lang === "sr") return new Set(["Cyrillic", "Latin"]);
  if (lang === "ja") return new Set(["Han", "Kana"]);
  if (lang === "zh") return new Set(["Han"]);
  if (lang === "ko") return new Set(["Hangul", "Han"]);
  if (["hi", "mr", "ne"].includes(lang)) return new Set(["Devanagari"]);
  if (["en", "fr", "de", "es", "pt", "it", "nl", "af", "vi", "id", "tl", "tr", "pl", "cs", "sk", "ro", "hu", "da", "sv", "fi", "no", "is", "et", "lv", "lt", "la", "ga", "eo"].includes(lang)) return new Set(["Latin"]);
  return null;
}

export function scriptCompatible(text: string, language: string): boolean {
  const expected = expectedScripts(language);
  if (!expected) return true;
  const counts = scriptsIn(text);
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (!total) return letterCount(text) === 0;
  const matching = [...counts].reduce((sum, [script, count]) => sum + (expected.has(script) ? count : 0), 0);
  return matching >= Math.max(1, total * 0.75);
}

function mixedScripts(text: string): boolean {
  const counts = scriptsIn(text);
  const strong = [...counts].filter(([, count]) => count >= 3).map(([script]) => script);
  return strong.length > 1 && !strong.every((script) => script === "Han" || script === "Kana");
}

function outsideTrackedScripts(text: string): boolean {
  const letters = letterCount(text);
  if (!letters) return false;
  const tracked = [...scriptsIn(text).values()].reduce((sum, count) => sum + count, 0);
  return letters - tracked > letters * 0.75;
}

// TinyLD scores are ranking evidence, not probabilities. Require a useful sample
// and a clear lead; leave short labels and ambiguous text unclassified.
export function detectLocalLanguage(text: string, _languages?: LanguageInfo[]): DetectionResult {
  if (letterCount(text) < 12 || technicalLabel.test(text.trim())) return { state: "uncertain", language: null };
  let results: Array<{ lang: string; accuracy: number }>;
  try { results = detectAll(text.slice(0, 10_000), { only: detectorCodes }); }
  catch { return { state: "uncertain", language: null }; }
  const first = results[0];
  if (!first) return { state: outsideTrackedScripts(text) ? "unsupported" : "uncertain", language: null };
  const second = results[1]?.accuracy ?? 0;
  const ratio = second > 0 ? first.accuracy / second : Number.POSITIVE_INFINITY;
  if (first.accuracy < 0.5 || ratio < 1.8 || !scriptCompatible(text, first.lang) || mixedScripts(text)) {
    return { state: "uncertain", language: null, score: first.accuracy, marginRatio: ratio };
  }
  return { state: "detected", language: first.lang, score: first.accuracy, marginRatio: ratio };
}

function classifyOne(unit: TranslationUnit, pageLanguage: string | null, blockCache: Map<string, DetectionResult>): ClassifiedUnit {
  const text = unit.getText();
  const uncertain = (reason: ClassifiedUnit["reason"] = "uncertain"): ClassifiedUnit => ({ unit, sourceLanguage: null, reason });
  if (technicalLabel.test(text.trim()) || mixedScripts(text)) return uncertain();
  const own = detectLocalLanguage(text);
  if (own.state === "detected" && own.language) return { unit, sourceLanguage: own.language, reason: "own" };

  const declaredElement = unit.element.closest("[lang]");
  const declared = closestDeclaredLanguage(unit.element);
  const specific = declaredElement && declaredElement !== unit.element.ownerDocument.documentElement && declaredElement !== unit.element.ownerDocument.body;
  if (specific && declared) {
    const code = normalizeLanguageCode(declared);
    if (scriptCompatible(text, code)) return { unit, sourceLanguage: code, reason: "element-lang" };
    return uncertain();
  }

  const blockText = getBlockText(unit.element);
  let block = blockCache.get(blockText);
  if (!block) { block = detectLocalLanguage(blockText); blockCache.set(blockText, block); }
  // A short Latin label inside a different Latin-language block has no reliable
  // local evidence. A non-Latin block cannot claim a Latin label either.
  if (block.state === "detected" && block.language && scriptCompatible(text, block.language)) {
    if (letterCount(text) >= 12 || !scriptsIn(text).has("Latin")) {
      return { unit, sourceLanguage: block.language, reason: "block" };
    }
  }
  if (block.state === "detected" && block.language && !scriptCompatible(text, block.language)) return uncertain();
  if (declared && scriptCompatible(text, declared) && letterCount(text) >= 12) {
    return { unit, sourceLanguage: normalizeLanguageCode(declared), reason: "page-lang" };
  }
  if (pageLanguage && scriptCompatible(text, pageLanguage) && letterCount(text) >= 12) {
    return { unit, sourceLanguage: pageLanguage, reason: "page" };
  }
  return uncertain(own.state === "unsupported" ? "detector-unsupported" : "uncertain");
}

export function classifyUnits(units: TranslationUnit[], _languages: LanguageInfo[]): ClassifiedUnit[] {
  const pageLanguage = estimatePageLanguage(units).language;
  const blockCache = new Map<string, DetectionResult>();
  return units.map((unit) => classifyOne(unit, pageLanguage, blockCache));
}

export function estimatePageLanguage(units: TranslationUnit[]): { language: string | null; sampledCharacters: number } {
  const seen = new Set<string>();
  const preferred: string[] = [];
  const fallback: string[] = [];
  let title = "";
  for (const unit of units) {
    if (unit.kind === "document-title") { title = unit.getText().slice(0, 200); continue; }
    if (unit.kind !== "text-node" || unit.element.closest("nav, header, footer, aside")) continue;
    const text = unit.getText().replace(/\s+/g, " ").trim();
    if (letterCount(text) < 40 || seen.has(text)) continue;
    seen.add(text);
    if (unit.element.closest("article, main, p, blockquote")) preferred.push(text);
    else fallback.push(text);
  }
  let sample = title ? `${title} ` : "";
  for (const text of [...preferred, ...fallback]) {
    if (sample.length >= 8000) break;
    sample += `${text.slice(0, 8000 - sample.length)} `;
  }
  sample = sample.slice(0, 8000);
  const detected = detectLocalLanguage(sample);
  if (detected.language) return { language: detected.language, sampledCharacters: sample.length };
  const document = units[0]?.document;
  const declared = document?.documentElement.lang || document?.querySelector('meta[http-equiv="content-language"]')?.getAttribute("content") || "";
  return { language: declared ? normalizeLanguageCode(declared) : null, sampledCharacters: sample.length };
}

export function classifyUnitsForSite(units: TranslationUnit[], languages: LanguageInfo[], sourceLanguage?: string | null): ClassifiedUnit[] {
  if (!sourceLanguage) return classifyUnits(units, languages);
  return units.map((unit) => ({ unit, sourceLanguage: normalizeLanguageCode(sourceLanguage), reason: "override" }));
}

export function shouldPrompt(classified: ClassifiedUnit[], targetLanguage: string): boolean {
  const foreign = classified.filter(({ sourceLanguage }) => sourceLanguage && normalizeLanguageCode(sourceLanguage) !== normalizeLanguageCode(targetLanguage));
  const characters = foreign.reduce((total, { unit }) => total + unit.getText().length, 0);
  return characters >= 80 || foreign.length >= 3;
}

export function shouldActOnSavedConsent(classified: ClassifiedUnit[], targetLanguage: string, always: boolean, never: boolean, explicitSource: string | null): boolean {
  if (!always || never) return false;
  const foreign = classified.filter(({ sourceLanguage }) => sourceLanguage && normalizeLanguageCode(sourceLanguage) !== normalizeLanguageCode(targetLanguage));
  return foreign.length > 0 && (Boolean(explicitSource) || shouldPrompt(foreign, targetLanguage));
}
