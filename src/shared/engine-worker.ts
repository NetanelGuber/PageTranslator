const CALL_TIMEOUT_MS: Record<string, number> = {
  initialize: 30_000,
  loadTranslationModel: 180_000,
  translate: 120_000
};

export class EngineWorker {
  private worker: Worker;
  private serial = 0;
  private alive = true;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  readonly ready: Promise<unknown>;

  constructor(url: string, private readonly onTerminated: (worker: EngineWorker) => void) {
    this.worker = new Worker(url);
    this.worker.addEventListener("message", ({ data }: MessageEvent<{ id: number; result?: unknown; error?: { message?: string; stack?: string } }>) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      clearTimeout(pending.timer);
      if (data.error) pending.reject(Object.assign(new Error(data.error.message ?? "Translation worker error."), { stack: data.error.stack }));
      else pending.resolve(data.result);
    });
    this.worker.addEventListener("error", (event) => this.terminate(new Error(event.message || "The translation worker stopped unexpectedly.")));
    this.worker.addEventListener("messageerror", () => this.terminate(new Error("The translation worker sent an unreadable response.")));
    this.ready = this.call("initialize", [{ cacheSize: 0, useNativeIntGemm: false }]).catch((error: unknown) => {
      this.terminate(error instanceof Error ? error : new Error("Translation worker initialization failed."));
      throw error;
    });
  }

  get isAlive(): boolean { return this.alive; }

  call<T>(name: string, args: unknown[] = [], transfers: Transferable[] = []): Promise<T> {
    if (!this.alive) return Promise.reject(new Error("The translation worker has terminated."));
    return new Promise<T>((resolve, reject) => {
      const id = ++this.serial;
      const timer = setTimeout(() => this.terminate(new Error(`Translation worker timed out during ${name}.`)), CALL_TIMEOUT_MS[name] ?? 30_000);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        this.worker.postMessage({ id, name, args }, transfers);
      } catch (error) {
        this.terminate(error instanceof Error ? error : new Error("Could not send a request to the translation worker."));
      }
    });
  }

  terminate(reason = new Error("Translation was cancelled.")): void {
    if (!this.alive) return;
    this.alive = false;
    this.worker.terminate();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
    this.onTerminated(this);
  }
}
