import type { RegistryFile } from "./model-registry";

export interface ModelCache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verify(compressed: ArrayBuffer, file: RegistryFile, signal: AbortSignal): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  let bytes = compressed;
  if (file.path.endsWith(".gz")) {
    try {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
      bytes = await new Response(stream).arrayBuffer();
    } catch { throw new Error(`Model file ${file.path} could not be decompressed.`); }
  }
  signal.throwIfAborted();
  if (file.uncompressedSize !== undefined && bytes.byteLength !== file.uncompressedSize) {
    throw new Error(`Model file ${file.path} had an unexpected size.`);
  }
  if (file.uncompressedHash && await sha256Hex(bytes) !== file.uncompressedHash.toLowerCase()) {
    throw new Error(`Model file ${file.path} failed its integrity check.`);
  }
  signal.throwIfAborted();
  return bytes;
}

/** Cache writes happen only after full decompression and integrity verification. */
export async function loadVerifiedModelFile(
  url: string, file: RegistryFile, cache: ModelCache, signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  onProgress?: (phase: "downloading" | "verifying") => void
): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  const cached = await cache.match(url);
  if (cached) {
    try {
      onProgress?.("verifying");
      return await verify(await cached.arrayBuffer(), file, signal);
    }
    catch (error) {
      signal.throwIfAborted();
      await cache.delete(url);
      if (error instanceof DOMException && error.name === "AbortError") throw error;
    }
  }
  onProgress?.("downloading");
  const response = await fetcher(url, { credentials: "omit", signal });
  if (!response.ok) throw new Error(`Model download failed (${response.status}) for ${file.path}.`);
  const compressed = await response.arrayBuffer();
  signal.throwIfAborted();
  onProgress?.("verifying");
  const bytes = await verify(compressed, file, signal);
  signal.throwIfAborted();
  await cache.put(url, new Response(compressed, { headers: response.headers }));
  return bytes;
}
