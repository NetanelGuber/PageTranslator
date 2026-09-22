import { describe, expect, it } from "vitest";
import { pageActionAvailability } from "../src/shared/page-actions";

describe("popup translation actions", () => {
  it.each(["downloading", "verifying", "loading", "pivoting", "translating"] as const)("enables cancellation during %s", (phase) => {
    expect(pageActionAvailability(phase, true, true)).toEqual({ cancel: true, restore: false });
  });

  it("keeps Show original for completed translations", () => {
    expect(pageActionAvailability("complete", true, true)).toEqual({ cancel: false, restore: true });
    expect(pageActionAvailability("complete", false, true)).toEqual({ cancel: false, restore: false });
    expect(pageActionAvailability("translating", true, false)).toEqual({ cancel: false, restore: false });
  });
});
