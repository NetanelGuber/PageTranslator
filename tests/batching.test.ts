import { describe, expect, it } from "vitest";
import { createBatches, requireMatchingCount, runWithConcurrency } from "../src/shared/batching";

describe("batching", () => {
  it("limits both item count and character count without losing order", () => {
    const items = ["aaa", "bbbb", "cc", "ddddd"];
    const batches = createBatches(items, (item) => item, 2, 6);
    expect(batches.map((batch) => batch.texts)).toEqual([["aaa"], ["bbbb", "cc"], ["ddddd"]]);
    expect(batches.flatMap((batch) => batch.items)).toEqual(items);
  });

  it("rejects an oversized item before it can become an oversized request", () => {
    expect(() => createBatches(["x".repeat(4001)], (item) => item)).toThrow(/exceeds/);
  });

  it("never runs more than the configured number of tasks concurrently", async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 6 }, (_, index) => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return index;
    });
    expect(await runWithConcurrency(tasks, 2)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it("rejects a short or long response at either pivot step", () => {
    expect(() => requireMatchingCount(2, 1, "es → en")).toThrow(/1 results for 2 inputs/);
    expect(() => requireMatchingCount(2, 3, "en → fr")).toThrow(/3 results for 2 inputs/);
    expect(() => requireMatchingCount(2, 2, "en → fr")).not.toThrow();
  });
});
