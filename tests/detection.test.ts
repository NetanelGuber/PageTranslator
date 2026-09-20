import { beforeEach, describe, expect, it } from "vitest";
import { classifyUnits, classifyUnitsForSite, detectLocalLanguage, estimatePageLanguage, scriptCompatible, shouldPrompt } from "../src/shared/detection";
import { collectTranslationUnits } from "../src/shared/dom";

const languages = [
  { code: "en", name: "English", targets: ["es", "fr"] },
  { code: "es", name: "Spanish", targets: ["en", "fr"] },
  { code: "fr", name: "French", targets: ["en", "es"] }
];

describe("local language detection", () => {
  beforeEach(() => { document.title = ""; });

  it("detects a sufficiently distinct language without a network request", () => {
    const result = detectLocalLanguage("Esta página contiene suficiente texto en español para identificar el idioma correctamente.", languages);
    expect(result?.language).toBe("es");
  });

  it("prefers declared lang metadata for blocks and detects mixed content", () => {
    document.body.innerHTML = `
      <article>
        <p lang="en">This paragraph is already written in the requested target language.</p>
        <p lang="es">Este párrafo contiene suficiente contenido extranjero para necesitar una traducción.</p>
        <p lang="es">También incluye una segunda sección claramente escrita en español.</p>
      </article>`;
    const classified = classifyUnits(collectTranslationUnits(document), languages);
    expect(classified.map((entry) => entry.sourceLanguage)).toContain("en");
    expect(classified.map((entry) => entry.sourceLanguage)).toContain("es");
    expect(shouldPrompt(classified, "en")).toBe(true);
  });

  it("uses only an explicit site source language and bypasses page declarations", () => {
    document.body.innerHTML = `
      <p lang="en">This text deliberately declares a different language.</p>
      <p lang="fr">Ce texte déclare également une langue différente.</p>`;
    const classified = classifyUnitsForSite(collectTranslationUnits(document), languages, "es");
    expect(classified).not.toHaveLength(0);
    expect(classified.every(({ sourceLanguage }) => sourceLanguage === "es")).toBe(true);
  });

  it("retains a detector-supported language even without a bundled model route", () => {
    const result = detectLocalLanguage("Это достаточно длинное предложение на русском языке для определения языка.", languages);
    expect(result.state).toBe("detected");
    expect(result.language).toBe("ru");
    expect(detectLocalLanguage("ეს არის ქართული ტექსტი და ის საკმარისად გრძელია ენის ამოსაცნობად.").state).toBe("unsupported");
  });

  it("uses reliable own text ahead of conflicting element, block, and page language", () => {
    document.documentElement.lang = "ar";
    document.body.innerHTML = `<article lang="ar"><p><span id="label" lang="ar">This English label names the account settings clearly.</span><span id="body">هذا نص عربي طويل بما يكفي للتعرف على اللغة بشكل صحيح.</span></p></article>`;
    const classified = classifyUnits(collectTranslationUnits(document), languages);
    expect(classified.find(({ unit }) => unit.element.id === "label")).toMatchObject({ sourceLanguage: "en", reason: "own" });
    expect(classified.find(({ unit }) => unit.element.id === "body")?.sourceLanguage).toBe("ar");
  });

  it("abstains for short incompatible labels and mixed-script nodes", () => {
    document.body.innerHTML = `<article><p><span id="english">Arabic:</span><span id="arabic">هذا نص عربي طويل بما يكفي للتعرف على اللغة بشكل صحيح.</span></p><p id="mixed">This English sentence includes كلمات عربية واضحة in one node.</p></article>`;
    const classified = classifyUnits(collectTranslationUnits(document), languages);
    expect(classified.find(({ unit }) => unit.element.id === "english")?.sourceLanguage).toBeNull();
    expect(classified.find(({ unit }) => unit.element.id === "arabic")?.sourceLanguage).toBe("ar");
    expect(classified.find(({ unit }) => unit.element.id === "mixed")?.sourceLanguage).toBeNull();
    expect(scriptCompatible("Arabic:", "ar")).toBe(false);
  });

  it("keeps a foreign label's own language when its English sibling dominates", () => {
    document.body.innerHTML = `<p><span id="foreign">これは十分に長い日本語の見出しであり、言語を判定できます。</span><span id="english">This English paragraph is long enough to dominate its neighboring block and page.</span></p>`;
    const classified = classifyUnits(collectTranslationUnits(document), languages);
    expect(classified.find(({ unit }) => unit.element.id === "foreign")?.sourceLanguage).toBe("ja");
    expect(classified.find(({ unit }) => unit.element.id === "english")?.sourceLanguage).toBe("en");
  });

  it("leaves short and technical labels uncertain without a reliable declaration", () => {
    document.body.innerHTML = `<section>${["FR:", "AR:", "RU:", "日本語:", "中文:", "HD", "4K", "IMDb", "TV", "FPS"].map((text) => `<span>${text}</span>`).join("")}</section>`;
    expect(classifyUnits(collectTranslationUnits(document), languages).every(({ sourceLanguage }) => sourceLanguage === null)).toBe(true);
  });

  it("keeps explicit site source preference authoritative for otherwise conflicting text", () => {
    document.body.innerHTML = `<p lang="en">This text is clearly English and contradicts the selected source.</p>`;
    expect(classifyUnitsForSite(collectTranslationUnits(document), languages, "es").every(({ sourceLanguage, reason }) => sourceLanguage === "es" && reason === "override")).toBe(true);
  });

  it("samples bounded meaningful article text instead of repeated navigation labels", () => {
    document.body.innerHTML = `<nav>${"<span>Open the account settings and check your messages.</span>".repeat(100)}</nav><article><p>${"Esta página contiene información importante en español sobre la traducción local. ".repeat(200)}</p></article>`;
    const estimate = estimatePageLanguage(collectTranslationUnits(document));
    expect(estimate.language).toBe("es");
    expect(estimate.sampledCharacters).toBeLessThanOrEqual(8000);
  });
});
