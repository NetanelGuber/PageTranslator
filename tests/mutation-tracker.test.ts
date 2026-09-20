import { describe, expect, it } from "vitest";
import { SelfWriteTracker } from "../src/shared/mutation-tracker";

describe("exact self-write suppression", () => {
  it("suppresses its own text write but retains a later site write in the same callback", async () => {
    const node = document.createTextNode("original");
    document.body.append(node);
    const tracker = new SelfWriteTracker();
    const observed: boolean[] = [];
    const observer = new MutationObserver((records) => observed.push(...records.map((record) => tracker.consume(record))));
    observer.observe(node, { characterData: true, characterDataOldValue: true });
    tracker.note(node, "characterData", null, "original", "translated");
    node.data = "translated";
    node.data = "site update";
    await Promise.resolve();
    expect(observed).toEqual([false, false]); // Current site value prevents masking even the earlier extension record.
    observer.disconnect();
  });

  it("suppresses an isolated attribute write", async () => {
    const element = document.createElement("p");
    element.setAttribute("title", "original");
    const tracker = new SelfWriteTracker();
    const observed: boolean[] = [];
    const observer = new MutationObserver((records) => observed.push(...records.map((record) => tracker.consume(record))));
    observer.observe(element, { attributes: true, attributeOldValue: true, attributeFilter: ["title"] });
    tracker.note(element, "attributes", "title", "original", "translated");
    element.setAttribute("title", "translated");
    await Promise.resolve();
    expect(observed).toEqual([true]);
    observer.disconnect();
  });
});
