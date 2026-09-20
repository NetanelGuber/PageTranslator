import { describe, expect, it, vi } from "vitest";
import { loadVerifiedModelFile, type ModelCache } from "../src/shared/model-files";
import { createHash } from "node:crypto";

function makeCache(initial?: Uint8Array) {
  const entries = new Map<string, Uint8Array>();
  if (initial) entries.set("https://models.test/file.bin", initial);
  const cache: ModelCache = {
    match: async (url) => entries.has(url) ? new Response(entries.get(url)!.slice() as BodyInit) : undefined,
    put: async (url, response) => { entries.set(url, new Uint8Array(await response.arrayBuffer())); },
    delete: async (url) => entries.delete(url)
  };
  return { cache, entries };
}

const url = "https://models.test/file.bin";
const file = { path: "file.bin", uncompressedSize: 4 };

describe("verified model file caching", () => {
  it("evicts corrupt cached bytes and stores a verified replacement", async () => {
    const { cache, entries } = makeCache(new Uint8Array([1, 2]));
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]) as BodyInit));
    const result = await loadVerifiedModelFile(url, file, cache, new AbortController().signal, fetcher as typeof fetch);
    expect([...new Uint8Array(result)]).toEqual([1, 2, 3, 4]);
    expect([...entries.get(url)!]).toEqual([1, 2, 3, 4]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not cache a corrupt fresh response", async () => {
    const { cache, entries } = makeCache();
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2]) as BodyInit));
    await expect(loadVerifiedModelFile(url, file, cache, new AbortController().signal, fetcher as typeof fetch)).rejects.toThrow(/unexpected size/);
    expect(entries.size).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects a fresh file with the expected size but a wrong hash", async () => {
    const { cache, entries } = makeCache();
    const hash = createHash("sha256").update(new Uint8Array([1, 2, 3, 4])).digest("hex");
    const fetcher = vi.fn(async () => new Response(new Uint8Array([4, 3, 2, 1]) as BodyInit));
    await expect(loadVerifiedModelFile(url, { ...file, uncompressedHash: hash }, cache, new AbortController().signal, fetcher as typeof fetch)).rejects.toThrow(/integrity check/);
    expect(entries.size).toBe(0);
  });

  it("stops a download when its request is cancelled", async () => {
    const { cache, entries } = makeCache();
    const controller = new AbortController();
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const pending = loadVerifiedModelFile(url, file, cache, controller.signal, fetcher as typeof fetch);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(entries.size).toBe(0);
  });

  it("stops during a response-body read without caching partial bytes", async () => {
    const { cache, entries } = makeCache();
    const controller = new AbortController();
    const fetcher = vi.fn((_url: string, init: RequestInit) => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      start(stream) { init.signal?.addEventListener("abort", () => stream.error(new DOMException("aborted", "AbortError"))); }
    }))));
    const pending = loadVerifiedModelFile(url, file, cache, controller.signal, fetcher as typeof fetch);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(entries.size).toBe(0);
  });
});
