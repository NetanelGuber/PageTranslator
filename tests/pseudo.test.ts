import { describe, expect, it } from "vitest";
import { parseLiteralContent } from "../src/shared/pseudo";

describe("literal CSS pseudo text", () => {
  it("decodes quoted Unicode and CSS escapes", () => {
    expect(parseLiteralContent('"Привет мир"')).toBe("Привет мир");
    expect(parseLiteralContent('"日本語の案内"')).toBe("日本語の案内");
    expect(parseLiteralContent('"مرحبا بالعالم"')).toBe("مرحبا بالعالم");
    expect(parseLiteralContent('"Bonjour \\e9quipe"')).toBe("Bonjour équipe");
  });

  it("rejects complex, decorative, and icon content", () => {
    for (const value of ['attr(title)', 'counter(list-item)', 'url(icon.svg)', 'open-quote', '"A" "B"', '"★"', '"\\e001"']) {
      expect(parseLiteralContent(value)).toBeNull();
    }
  });
});
