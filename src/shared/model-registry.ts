import type { LanguageInfo } from "./types";
import { normalizeLanguageCode } from "./languages";

export interface RegistryFile {
  path: string;
  uncompressedSize?: number;
  uncompressedHash?: string;
}

export interface RegistryModel {
  architecture?: string;
  releaseStatus?: string | null;
  sourceLanguage: string;
  targetLanguage: string;
  files: {
    model: RegistryFile;
    lexicalShortlist: RegistryFile;
    vocab?: RegistryFile;
    srcVocab?: RegistryFile;
    trgVocab?: RegistryFile;
  };
}

export interface ModelRegistry {
  generated: string;
  baseUrl: string;
  models: Record<string, RegistryModel[]>;
}

export interface ModelPair {
  from: string;
  to: string;
  model: RegistryModel;
}

export function modelLanguageCode(code: string): string {
  return normalizeLanguageCode(code.replaceAll("_", "-")).toLowerCase();
}

export function releasePairs(registry: ModelRegistry): ModelPair[] {
  const pairs: ModelPair[] = [];
  for (const entries of Object.values(registry.models)) {
    const model = entries.find((entry) => entry.releaseStatus === "Release");
    if (!model) continue;
    pairs.push({
      from: modelLanguageCode(model.sourceLanguage),
      to: modelLanguageCode(model.targetLanguage),
      model
    });
  }
  return pairs;
}

export function findRoute(pairs: ModelPair[], source: string, target: string): ModelPair[] | null {
  const from = modelLanguageCode(source);
  const to = modelLanguageCode(target);
  const direct = pairs.find((pair) => pair.from === from && pair.to === to);
  if (direct) return [direct];
  if (from === "en" || to === "en") return null;
  const first = pairs.find((pair) => pair.from === from && pair.to === "en");
  const second = pairs.find((pair) => pair.from === "en" && pair.to === to);
  return first && second ? [first, second] : null;
}

export function createLanguageCatalog(pairs: ModelPair[]): LanguageInfo[] {
  const codes = [...new Set(pairs.flatMap((pair) => [pair.from, pair.to]))].sort();
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  return codes.map((code) => ({
    code,
    name: names.of(code) ?? code,
    targets: codes.filter((target) => target !== code && findRoute(pairs, code, target) !== null)
  }));
}

export function modelFileUrl(registry: ModelRegistry, file: RegistryFile): string {
  return `${registry.baseUrl.replace(/\/$/, "")}/${file.path.replace(/^\//, "")}`;
}
