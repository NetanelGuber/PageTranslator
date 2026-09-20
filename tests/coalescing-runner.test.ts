import { describe, expect, it } from "vitest";
import { CoalescingRunner } from "../src/shared/coalescing-runner";

describe("CoalescingRunner", () => {
  it("serializes work and collapses changes during a run to the latest request", async () => {
    const runner = new CoalescingRunner<number>();
    const seen: number[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const task = async (value: number) => {
      seen.push(value);
      if (value === 1) await firstBlocked;
    };

    const running = runner.run(1, task);
    void runner.run(2, task);
    void runner.run(3, task);
    await Promise.resolve();
    expect(seen).toEqual([1]);
    releaseFirst();
    await running;
    expect(seen).toEqual([1, 3]);
  });
});
