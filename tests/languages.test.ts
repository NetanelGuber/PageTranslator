import { describe, expect, it } from "vitest";
import { chooseDefaultTarget, normalizeLanguageCode, resolveSupportedCode, supportsPair } from "../src/shared/languages";

const languages = [
  { code: "en", name: "English", targets: ["es", "fr"] },
  { code: "es", name: "Spanish", targets: ["en"] },
  { code: "zh-Hant", name: "Chinese (Traditional)", targets: ["en"] }
];

describe("language helpers", () => {
  it("normalizes BCP 47 variants", () => {
    expect(normalizeLanguageCode("EN_us")).toBe("en-US");
  });

  it("prefers an exact variant and then a primary-language fallback", () => {
    expect(resolveSupportedCode("zh-Hant", languages)).toBe("zh-Hant");
    expect(resolveSupportedCode("es-MX", languages)).toBe("es");
  });

  it("requires a direct target advertised by the source", () => {
    expect(supportsPair(languages, "es", "en")).toBe(true);
    expect(supportsPair(languages, "es", "fr")).toBe(false);
  });

  it("uses the browser preference only when supported", () => {
    expect(chooseDefaultTarget(languages, "es-MX")).toBe("es");
    expect(chooseDefaultTarget(languages, "de-DE")).toBe("");
  });
});
