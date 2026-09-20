import { describe, expect, it } from "vitest";
import { joinTranslatedChunks, splitText } from "../src/shared/chunking";

describe("oversized translation units", () => {
  for (const text of [
    "x".repeat(4000), "x".repeat(4001), "x".repeat(20_000),
    "Sentence one. Sentence two! ".repeat(900),
    "😀e\u0301日本語 مرحبا ".repeat(1200),
    "漢字仮名交じり文".repeat(3000)
  ]) {
    it(`preserves all ${text.length} source characters and enforces the input limit`, () => {
      const chunks = splitText(text);
      expect(chunks.map((chunk) => chunk.text + chunk.separator).join("")).toBe(text);
      expect(chunks.every((chunk) => chunk.text.length <= 4000 && chunk.text.length > 0)).toBe(true);
    });
  }

  it("does not split emoji or combining sequences at a hard boundary", () => {
    const chunks = splitText("x".repeat(3999) + "😀e\u0301" + "y".repeat(4000));
    expect(chunks[0]?.text).toBe("x".repeat(3999));
    expect(chunks[1]?.text.startsWith("😀e\u0301")).toBe(true);
  });

  it("fails clearly when a single grapheme itself is above the input limit", () => {
    if (typeof Intl.Segmenter === "function") expect(() => splitText("a" + "\u0301".repeat(4000))).toThrow(/single grapheme/);
  });

  it("reassembles ordered outputs with the original paragraph separators", () => {
    const chunks = splitText("Bonjour tout le monde.\n\n".repeat(300), 100);
    const outputs = chunks.map((_, index) => `Result ${index}  `);
    const joined = joinTranslatedChunks(chunks, outputs);
    expect(joined.indexOf("Result 0")).toBeLessThan(joined.indexOf("Result 1"));
    expect(joined).toContain("Result 0\n\n");
    expect(() => joinTranslatedChunks(chunks, outputs.slice(1))).toThrow(/missing/);
  });
});
