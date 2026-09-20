export interface TextBatch<T> {
  items: T[];
  texts: string[];
  characterCount: number;
}

export function requireMatchingCount(expected: number, actual: number, stage: string): void {
  if (actual !== expected) throw new Error(`${stage} returned ${actual} results for ${expected} inputs.`);
}

export function createBatches<T>(
  items: T[],
  getText: (item: T) => string,
  maxItems = 50,
  maxCharacters = 4000
): TextBatch<T>[] {
  const batches: TextBatch<T>[] = [];
  let current: TextBatch<T> = { items: [], texts: [], characterCount: 0 };

  for (const item of items) {
    const text = getText(item);
    if (text.length > maxCharacters) throw new RangeError(`A ${text.length}-character item exceeds the ${maxCharacters}-character batch limit.`);
    if (current.items.length > 0 && (current.items.length >= maxItems || current.characterCount + text.length > maxCharacters)) {
      batches.push(current);
      current = { items: [], texts: [], characterCount: 0 };
    }
    current.items.push(item);
    current.texts.push(text);
    current.characterCount += text.length;
  }

  if (current.items.length > 0) batches.push(current);
  return batches;
}

export async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit = 2): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      const task = tasks[index];
      if (task) results[index] = await task();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}
