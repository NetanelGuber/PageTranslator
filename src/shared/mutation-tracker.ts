interface ExpectedWrite {
  type: "characterData" | "attributes";
  attributeName: string | null;
  oldValue: string | null;
  newValue: string | null;
}

/** Matches only an extension write's exact transition; a later site write stays observable. */
export class SelfWriteTracker {
  private expected = new WeakMap<Node, ExpectedWrite[]>();

  note(target: Node, type: ExpectedWrite["type"], attributeName: string | null, oldValue: string | null, newValue: string | null): void {
    const list = this.expected.get(target) ?? [];
    list.push({ type, attributeName, oldValue, newValue });
    this.expected.set(target, list);
  }

  consume(record: MutationRecord): boolean {
    if (record.type !== "characterData" && record.type !== "attributes") return false;
    const list = this.expected.get(record.target);
    if (!list) return false;
    const index = list.findIndex((write) => write.type === record.type && write.attributeName === record.attributeName && write.oldValue === record.oldValue);
    if (index < 0) return false;
    const [write] = list.splice(index, 1);
    if (list.length === 0) this.expected.delete(record.target);
    const current = record.type === "characterData"
      ? record.target.textContent
      : (record.target as Element).getAttribute(record.attributeName!);
    return current === write!.newValue;
  }

  clear(): void { this.expected = new WeakMap(); }
}
