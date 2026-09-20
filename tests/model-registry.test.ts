import { describe, expect, it } from "vitest";
import { createLanguageCatalog, findRoute, releasePairs, type ModelRegistry } from "../src/shared/model-registry";

const registry: ModelRegistry = {
  generated: "test",
  baseUrl: "https://models.example",
  models: {
    "es-en": [{ releaseStatus: "Release", sourceLanguage: "es", targetLanguage: "en", files: {} as never }],
    "en-fr": [{ releaseStatus: "Release", sourceLanguage: "en", targetLanguage: "fr", files: {} as never }],
    "de-en": [{ releaseStatus: "Nightly", sourceLanguage: "de", targetLanguage: "en", files: {} as never }]
  }
};

describe("model registry", () => {
  it("uses release models and creates direct and sequential pivot routes", () => {
    const pairs = releasePairs(registry);
    expect(findRoute(pairs, "es", "en")).toHaveLength(1);
    expect(findRoute(pairs, "es", "fr")).toHaveLength(2);
    expect(findRoute(pairs, "de", "en")).toBeNull();
  });

  it("exposes only reachable targets for each language", () => {
    const catalog = createLanguageCatalog(releasePairs(registry));
    expect(catalog.find((language) => language.code === "es")?.targets).toEqual(["en", "fr"]);
    expect(catalog.find((language) => language.code === "fr")?.targets).toEqual([]);
  });
});
