import { findRoute, modelFileUrl, releasePairs, type ModelPair, type ModelRegistry, type RegistryFile } from "./shared/model-registry";
import type { ExtensionFailure, PagePhase, RuntimeMessage, TranslationResponse } from "./shared/types";
import { requireMatchingCount } from "./shared/batching";
import { loadVerifiedModelFile } from "./shared/model-files";

const MODEL_CACHE = "page-translator-models-v1";
const IDLE_TIMEOUT_MS = 30_000;

interface WorkerMemoryStats {
  wasmHeapBytes: number;
  loadedModels: number;
}

interface WorkerTranslation {
  target: { text: string };
}

let registryPromise: Promise<ModelRegistry> | null = null;
let workerClient: EngineWorker | null = null;
let loadedPair: { from: string; to: string } | null = null;
let queue: Promise<void> = Promise.resolve();
let activeRequestId: string | null = null;
let activeAbortController: AbortController | null = null;
let idleTimer: number | null = null;
const cancelled = new Set<string>();

function failure(code: string, message: string): ExtensionFailure {
  return { ok: false, code, message };
}

async function loadRegistry(): Promise<ModelRegistry> {
  registryPromise ??= fetch(chrome.runtime.getURL("models.json")).then(async (response) => {
    if (!response.ok) throw new Error("The bundled translation model catalog could not be loaded.");
    return response.json() as Promise<ModelRegistry>;
  });
  return registryPromise;
}

function postProgress(requestId: string, phase: PagePhase, message: string): void {
  void chrome.runtime.sendMessage({ type: "ENGINE_PROGRESS", targetContext: "background", requestId, phase, message } satisfies RuntimeMessage);
}

async function fetchModelFile(registry: ModelRegistry, file: RegistryFile, requestId: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const url = modelFileUrl(registry, file);
  const cache = await caches.open(MODEL_CACHE);
  return loadVerifiedModelFile(url, file, cache, signal, fetch, (phase) =>
    postProgress(requestId, phase, `${phase === "downloading" ? "Downloading" : "Verifying"} ${file.path.split("/").at(-1)}…`));
}

async function loadBuffers(registry: ModelRegistry, pair: ModelPair, requestId: string, signal: AbortSignal): Promise<{
  model: ArrayBuffer;
  shortlist: ArrayBuffer;
  vocabs: ArrayBuffer[];
  config: Record<string, string | boolean>;
}> {
  const files = pair.model.files;
  postProgress(requestId, "loading", `Preparing the ${pair.from} → ${pair.to} language model…`);
  const model = await fetchModelFile(registry, files.model, requestId, signal);
  if (cancelled.has(requestId)) throw new Error("Translation was cancelled.");
  const shortlist = await fetchModelFile(registry, files.lexicalShortlist, requestId, signal);
  let vocabs: ArrayBuffer[];
  if (files.vocab) {
    vocabs = [await fetchModelFile(registry, files.vocab, requestId, signal)];
  } else if (files.srcVocab && files.trgVocab) {
    vocabs = [await fetchModelFile(registry, files.srcVocab, requestId, signal), await fetchModelFile(registry, files.trgVocab, requestId, signal)];
  } else {
    throw new Error(`The ${pair.from} → ${pair.to} model is missing its vocabulary.`);
  }
  const config: Record<string, string | boolean> = {};
  if (files.model.path.includes("intgemm8")) config["gemm-precision"] = "int8shiftAll";
  return { model, shortlist, vocabs, config };
}

class EngineWorker {
  private worker = new Worker(chrome.runtime.getURL("engine/translator-worker.js"));
  private serial = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  readonly ready: Promise<unknown>;

  constructor() {
    this.worker.addEventListener("message", ({ data }: MessageEvent<{ id: number; result?: unknown; error?: { message?: string; stack?: string } }>) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.error) pending.reject(Object.assign(new Error(data.error.message ?? "Translation worker error."), { stack: data.error.stack }));
      else pending.resolve(data.result);
    });
    this.worker.addEventListener("error", (event) => this.terminate(new Error(event.message || "The translation worker stopped unexpectedly.")));
    this.ready = this.call("initialize", [{ cacheSize: 0, useNativeIntGemm: false }]);
  }

  call<T>(name: string, args: unknown[] = [], transfers: Transferable[] = []): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++this.serial;
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ id, name, args }, transfers);
    });
  }

  terminate(reason = new Error("Translation was cancelled.")): void {
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(reason);
    this.pending.clear();
  }
}

async function getWorker(): Promise<EngineWorker> {
  if (!workerClient) {
    workerClient = new EngineWorker();
    await workerClient.ready;
  }
  return workerClient;
}

function releaseWorker(): void {
  workerClient?.terminate(new Error("Translation engine released after becoming idle."));
  workerClient = null;
  loadedPair = null;
}

async function evictPairFiles(registry: ModelRegistry, pair: ModelPair): Promise<void> {
  const cache = await caches.open(MODEL_CACHE);
  for (const file of Object.values(pair.model.files)) {
    if (file) await cache.delete(modelFileUrl(registry, file));
  }
}

async function ensureModelLoaded(
  worker: EngineWorker,
  registry: ModelRegistry,
  pair: ModelPair,
  requestId: string,
  signal: AbortSignal
): Promise<void> {
  if (loadedPair?.from === pair.from && loadedPair.to === pair.to) return;
  if (loadedPair) {
    await worker.call("freeTranslationModel", [loadedPair]);
    loadedPair = null;
  }
  const buffers = await loadBuffers(registry, pair, requestId, signal);
  if (cancelled.has(requestId)) throw new Error("Translation was cancelled.");
  postProgress(requestId, "loading", `Loading the ${pair.from} → ${pair.to} language model…`);
  const transfers = [buffers.model, buffers.shortlist, ...buffers.vocabs];
  await worker.call("loadTranslationModel", [{ from: pair.from, to: pair.to }, buffers], transfers);
  loadedPair = { from: pair.from, to: pair.to };
}

async function translate(message: Extract<RuntimeMessage, { type: "ENGINE_TRANSLATE" }>): Promise<TranslationResponse> {
  if (cancelled.has(message.requestId)) {
    cancelled.delete(message.requestId);
    return failure("CANCELLED", "Translation was cancelled.");
  }
  if (idleTimer !== null) {
    window.clearTimeout(idleTimer);
    idleTimer = null;
  }
  activeRequestId = message.requestId;
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;
  let peakWasmHeapBytes = 0;
  try {
    const registry = await loadRegistry();
    const route = findRoute(releasePairs(registry), message.source, message.target);
    if (!route) return failure("UNSUPPORTED", `${message.source} → ${message.target} is not available on device.`);
    let texts = message.texts;
    for (let index = 0; index < route.length; index += 1) {
      if (cancelled.has(message.requestId)) return failure("CANCELLED", "Translation was cancelled.");
      const pair = route[index]!;
      let worker = await getWorker();
      try {
        await ensureModelLoaded(worker, registry, pair, message.requestId, signal);
      } catch (error) {
        if (signal.aborted || cancelled.has(message.requestId)) throw error;
        const messageText = error instanceof Error ? error.message : "";
        if (!/memory access out of bounds/i.test(messageText) && /download failed|unexpected size|integrity check|decompressed/i.test(messageText)) throw error;
        if (!/memory access out of bounds/i.test(messageText)) await evictPairFiles(registry, pair);
        releaseWorker();
        worker = await getWorker();
        await ensureModelLoaded(worker, registry, pair, message.requestId, signal);
      }
      signal.throwIfAborted();
      const afterLoad = await worker.call<WorkerMemoryStats>("getMemoryStats");
      signal.throwIfAborted();
      peakWasmHeapBytes = Math.max(peakWasmHeapBytes, afterLoad.wasmHeapBytes);
      postProgress(message.requestId, route.length > 1 && index > 0 ? "pivoting" : "translating", route.length > 1 ? `Translating step ${index + 1} of ${route.length}…` : "Translating on this device…");
      const input = [{
        models: [{ from: pair.from, to: pair.to }],
        texts: texts.map((text) => ({ text, html: false, qualityScores: false }))
      }];
      let responses: WorkerTranslation[];
      try {
        responses = await worker.call<WorkerTranslation[]>("translate", input);
      } catch (error) {
        if (!(error instanceof Error) || !/memory access out of bounds/i.test(error.message) || cancelled.has(message.requestId) || signal.aborted) throw error;
        releaseWorker();
        worker = await getWorker();
        await ensureModelLoaded(worker, registry, pair, message.requestId, signal);
        responses = await worker.call<WorkerTranslation[]>("translate", input);
      }
      signal.throwIfAborted();
      requireMatchingCount(texts.length, responses.length, `${pair.from} → ${pair.to} pivot step ${index + 1}`);
      texts = responses.map((response) => response.target.text);
    }
    const worker = await getWorker();
    const memory = await worker.call<WorkerMemoryStats>("getMemoryStats");
    return { ok: true, translatedTexts: texts, memory: { wasmHeapBytes: memory.wasmHeapBytes, peakWasmHeapBytes } };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "On-device translation failed.";
    return failure(cancelled.has(message.requestId) ? "CANCELLED" : "ENGINE", messageText);
  } finally {
    activeRequestId = null;
    activeAbortController = null;
    cancelled.delete(message.requestId);
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      releaseWorker();
      void chrome.runtime.sendMessage({ type: "ENGINE_IDLE", targetContext: "background" } satisfies RuntimeMessage);
    }, IDLE_TIMEOUT_MS);
  }
}

function enqueueTranslation(message: Extract<RuntimeMessage, { type: "ENGINE_TRANSLATE" }>): Promise<TranslationResponse> {
  return new Promise((resolve) => {
    queue = queue.then(async () => resolve(await translate(message)), async () => resolve(await translate(message)));
  });
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (!("targetContext" in message) || message.targetContext !== "offscreen") return false;
  if (message.type === "ENGINE_TRANSLATE") {
    void enqueueTranslation(message).then(sendResponse);
    return true;
  }
  if (message.type === "ENGINE_CANCEL") {
    message.requestIds.forEach((id) => cancelled.add(id));
    if (activeRequestId && message.requestIds.includes(activeRequestId)) { activeAbortController?.abort(); releaseWorker(); }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
