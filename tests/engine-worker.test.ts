import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineWorker } from "../src/shared/engine-worker";

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  static failPost = false;
  calls: Array<{ id: number; name: string }> = [];
  terminated = false;
  constructor(_url: string) { super(); FakeWorker.instances.push(this); }
  postMessage(message: { id: number; name: string }): void {
    if (FakeWorker.failPost) { FakeWorker.failPost = false; throw new Error("postMessage failed"); }
    this.calls.push(message);
  }
  terminate(): void { this.terminated = true; }
  answer(index: number, result?: unknown, error?: { message: string }): void {
    this.dispatchEvent(new MessageEvent("message", { data: { id: this.calls[index]!.id, result, error } }));
  }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); FakeWorker.instances = []; FakeWorker.failPost = false; });

describe("EngineWorker failure recovery", () => {
  it("terminates on failed initialization, then a fresh instance can initialize", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const failed = new EngineWorker("worker.js", () => undefined);
    FakeWorker.instances[0]!.answer(0, undefined, { message: "WASM failed" });
    await expect(failed.ready).rejects.toThrow("WASM failed");
    expect(failed.isAlive).toBe(false);
    await expect(failed.call("translate")).rejects.toThrow("terminated");
    const next = new EngineWorker("worker.js", () => undefined);
    FakeWorker.instances[1]!.answer(0, true);
    await expect(next.ready).resolves.toBe(true);
  });

  it("rejects outstanding calls on worker error", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const worker = new EngineWorker("worker.js", () => undefined);
    FakeWorker.instances[0]!.answer(0, true);
    await worker.ready;
    const call = worker.call("translate");
    FakeWorker.instances[0]!.dispatchEvent(new ErrorEvent("error", { message: "crashed" }));
    await expect(call).rejects.toThrow("crashed");
    expect(worker.isAlive).toBe(false);
    const next = new EngineWorker("worker.js", () => undefined);
    FakeWorker.instances[1]!.answer(0, true);
    await expect(next.ready).resolves.toBe(true);
  });

  it("terminates and rejects an unanswered call", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    const worker = new EngineWorker("worker.js", () => undefined);
    FakeWorker.instances[0]!.answer(0, true);
    await worker.ready;
    const call = worker.call("translate");
    const assertion = expect(call).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
    expect(FakeWorker.instances[0]!.terminated).toBe(true);
    const next = new EngineWorker("worker.js", () => undefined);
    FakeWorker.instances[1]!.answer(0, true);
    await expect(next.ready).resolves.toBe(true);
  });

  it("rejects when postMessage throws and allows a fresh worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.failPost = true;
    const failed = new EngineWorker("worker.js", () => undefined);
    await expect(failed.ready).rejects.toThrow("postMessage failed");
    expect(failed.isAlive).toBe(false);
    const next = new EngineWorker("worker.js", () => undefined);
    FakeWorker.instances[1]!.answer(0, true);
    await expect(next.ready).resolves.toBe(true);
  });
});
