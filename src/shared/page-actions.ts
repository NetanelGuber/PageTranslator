import type { PagePhase } from "./types";

export function pageActionAvailability(phase: PagePhase, canRestore: boolean, hasTab: boolean): { cancel: boolean; restore: boolean } {
  const cancel = hasTab && ["downloading", "verifying", "loading", "pivoting", "translating"].includes(phase);
  return { cancel, restore: hasTab && canRestore && !cancel };
}
