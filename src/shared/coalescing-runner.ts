/**
 * Runs one asynchronous task at a time. Requests received while a task is
 * active are collapsed into one follow-up run using the newest value.
 */
export class CoalescingRunner<T> {
  private pending: T | null = null;
  private active: Promise<void> | null = null;

  clearPending(): void { this.pending = null; }

  run(value: T, task: (value: T) => Promise<void>): Promise<void> {
    this.pending = value;
    if (!this.active) {
      this.active = this.drain(task).finally(() => { this.active = null; });
    }
    return this.active;
  }

  private async drain(task: (value: T) => Promise<void>): Promise<void> {
    while (this.pending !== null) {
      const value = this.pending;
      this.pending = null;
      await task(value);
    }
  }
}
