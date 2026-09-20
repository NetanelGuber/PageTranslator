import { describe, expect, it } from "vitest";
import { ProcessedMarker } from "../src/shared/processed-marker";

describe("unchanged-success marker", () => {
  it("requires the exact source value and language direction and clears on force", () => {
    const marker = new ProcessedMarker();
    const owner = document.createTextNode("texto");
    marker.mark(owner, "textContent", "texto", "es", "en");
    expect(marker.has(owner, "textContent", "texto", "es", "en")).toBe(true);
    expect(marker.has(owner, "textContent", "nuevo", "es", "en")).toBe(false);
    expect(marker.has(owner, "textContent", "texto", "es", "fr")).toBe(false);
    expect(marker.has(owner, "textContent", "texto", "fr", "en")).toBe(false);
    marker.clear();
    expect(marker.has(owner, "textContent", "texto", "es", "en")).toBe(false);
  });
});
