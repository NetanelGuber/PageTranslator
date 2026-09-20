import { describe, expect, it } from "vitest";
import { LruCache } from "../src/shared/lru-cache";

describe("bounded translation cache", () => {
  it("evicts the least recently used entry and refreshes recency on a hit", () => {
    const cache = new LruCache<string, string>(2, 100);
    cache.set("a", "one"); cache.set("b", "two");
    expect(cache.get("a")).toBe("one");
    cache.set("c", "three");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("one");
    expect(cache.size).toBe(2);
  });

  it("enforces a character budget and ignores an oversized result", () => {
    const cache = new LruCache<string, string>(10, 12);
    cache.set("a", "12345"); cache.set("b", "12345");
    expect(cache.characterCount).toBe(12);
    cache.set("c", "12345");
    expect(cache.get("a")).toBeUndefined();
    cache.set("huge", "x".repeat(20));
    expect(cache.size).toBe(2);
  });
});
