export class LruCache<K, V extends string> {
  private values = new Map<K, V>();
  private characters = 0;

  constructor(readonly maxEntries = 3000, readonly maxCharacters = 2_000_000) {}

  get size(): number { return this.values.size; }
  get characterCount(): number { return this.characters; }

  get(key: K): V | undefined {
    const value = this.values.get(key);
    if (value === undefined) return undefined;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    const previous = this.values.get(key);
    if (previous !== undefined) { this.characters -= String(key).length + previous.length; this.values.delete(key); }
    if (String(key).length + value.length > this.maxCharacters) return;
    this.values.set(key, value);
    this.characters += String(key).length + value.length;
    while (this.values.size > this.maxEntries || this.characters > this.maxCharacters) {
      const oldest = this.values.keys().next().value as K;
      const removed = this.values.get(oldest)!;
      this.characters -= String(oldest).length + removed.length;
      this.values.delete(oldest);
    }
  }

  clear(): void { this.values.clear(); this.characters = 0; }
}
