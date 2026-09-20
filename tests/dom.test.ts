import { beforeEach, describe, expect, it } from "vitest";
import { collectTranslationUnits, restoreIfUnchanged } from "../src/shared/dom";

describe("DOM extraction", () => {
  beforeEach(() => {
    document.head.innerHTML = "<title>Original title</title>";
    document.body.innerHTML = `
      <main>
        <p id="visible">Texto visible para traducir.</p>
        <p id="hidden" hidden>Texto escondido.</p>
        <code id="code">const mensaje = 'hola';</code>
        <div id="editable" contenteditable="true">Texto del usuario.</div>
        <input id="placeholder" placeholder="Escriba aquí" />
        <input id="password" type="password" title="Contraseña secreta" />
        <img id="image" alt="Una fotografía" />
        <script>window.bad = 'No traducir';</script>
      </main>`;
  });

  it("collects visible readable text, attributes, and the document title", () => {
    const texts = collectTranslationUnits(document, false).map((unit) => unit.getText());
    expect(texts).toContain("Texto visible para traducir.");
    expect(texts).toContain("Escriba aquí");
    expect(texts).toContain("Una fotografía");
    expect(texts).toContain("Original title");
    expect(texts).not.toContain("Texto escondido.");
    expect(texts).not.toContain("const mensaje = 'hola';");
    expect(texts).not.toContain("Texto del usuario.");
    expect(texts).not.toContain("Contraseña secreta");
    expect(texts).not.toContain("window.bad = 'No traducir';");
  });

  it("aggressive mode adds hidden and code text but keeps safety exclusions", () => {
    const texts = collectTranslationUnits(document, true).map((unit) => unit.getText());
    expect(texts).toContain("Texto escondido.");
    expect(texts).toContain("const mensaje = 'hola';");
    expect(texts).not.toContain("Texto del usuario.");
    expect(texts).not.toContain("Contraseña secreta");
    expect(texts).not.toContain("window.bad = 'No traducir';");
  });

  it("restores only when a site has not replaced the translated value", () => {
    const unit = collectTranslationUnits(document).find((candidate) => candidate.getText() === "Texto visible para traducir.")!;
    const original = unit.getValue();
    unit.setTranslation("Visible text to translate.");
    const translated = unit.getValue();
    expect(restoreIfUnchanged(unit, original, translated)).toBe(true);
    expect(unit.getValue()).toBe(original);

    unit.setTranslation("Translated again");
    const secondTranslation = unit.getValue();
    unit.setValue("Website supplied newer text");
    expect(restoreIfUnchanged(unit, original, secondTranslation)).toBe(false);
    expect(unit.getValue()).toBe("Website supplied newer text");
  });

  it("collects nested open shadow roots once and skips the extension banner", () => {
    const host = document.createElement("div");
    host.id = "host";
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<span>Texto español visible en la primera raíz.</span><div id="nested"></div>`;
    const nested = shadow.querySelector("#nested")!.attachShadow({ mode: "open" });
    nested.innerHTML = `<span>Otra oración española visible en la segunda raíz.</span>`;
    const units = collectTranslationUnits(document);
    expect(units.filter((unit) => unit.kind === "text-node" && unit.getText().includes("raíz"))).toHaveLength(2);
    expect(new Set(units.map((unit) => unit.owner)).size).toBe(units.length);
  });

  it("collects an accessible frame and tolerates a denied frame document", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    frame.contentDocument!.body.innerHTML = `<p>Este documento enmarcado contiene texto español legible.</p>`;
    expect(collectTranslationUnits(document).some((unit) => unit.getText().includes("documento enmarcado"))).toBe(true);
    Object.defineProperty(frame, "contentDocument", { configurable: true, get: () => { throw new DOMException("denied", "SecurityError"); } });
    expect(() => collectTranslationUnits(document)).not.toThrow();
  });

  it("rechecks visibility after an ancestor changes and across a shadow host", () => {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    document.body.append(host);
    host.attachShadow({ mode: "open" }).innerHTML = `<p>Texto español visible después del cambio.</p>`;
    expect(collectTranslationUnits(document).some((unit) => unit.getText().includes("después"))).toBe(false);
    host.removeAttribute("aria-hidden");
    expect(collectTranslationUnits(document).some((unit) => unit.getText().includes("después"))).toBe(true);
  });
});
