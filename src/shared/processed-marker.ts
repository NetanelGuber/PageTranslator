export class ProcessedMarker {
  private entries = new WeakMap<Node, Map<string, { value: string; source: string; target: string }>>();

  mark(owner: Node, field: string, value: string, source: string, target: string): void {
    const fields = this.entries.get(owner) ?? new Map();
    fields.set(field, { value, source, target });
    this.entries.set(owner, fields);
  }

  has(owner: Node, field: string, value: string, source: string, target: string): boolean {
    const entry = this.entries.get(owner)?.get(field);
    return entry?.value === value && entry.source === source && entry.target === target;
  }

  clear(): void { this.entries = new WeakMap(); }
}
