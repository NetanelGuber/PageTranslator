import { describe, expect, it } from "vitest";
import { DiagnosticBuffer, diagnosticFor } from "../src/shared/diagnostics";
import { collectTranslationUnits } from "../src/shared/dom";

describe("developer diagnostics", () => {
  it("keeps a bounded truncated sample and a short selector", () => {
    document.body.innerHTML = `<p id="sample">${"Texto español para una prueba. ".repeat(8)}</p>`;
    const unit = collectTranslationUnits(document).find((entry) => entry.kind === "text-node")!;
    const buffer = new DiagnosticBuffer(2);
    for (const outcome of ["uncertain", "translated", "already-target"] as const) {
      buffer.push(diagnosticFor(unit, outcome, "es", "en"));
    }
    expect(buffer.list()).toHaveLength(2);
    expect(buffer.list()[0]?.outcome).toBe("translated");
    expect(buffer.list()[0]?.selector).toBe("#sample");
    expect(buffer.list()[0]?.sample.length).toBeLessThanOrEqual(80);
    buffer.clear();
    expect(buffer.list()).toEqual([]);
  });
});
