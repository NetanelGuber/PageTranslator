export interface TextChunk { text: string; separator: string; }

function lastBoundary(value: string, limit: number, pattern: RegExp): { end: number; separator: string } | null {
  let result: { end: number; separator: string } | null = null;
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) && match.index + match[0].length <= limit) {
    const end = match.index + match[0].length;
    if (end >= Math.min(100, limit / 3)) result = { end, separator: match[0].match(/\s+$/u)?.[0] ?? "" };
  }
  return result;
}

function graphemeCut(value: string, limit: number): number {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    let end = 0;
    for (const segment of segmenter.segment(value)) {
      const next = segment.index + segment.segment.length;
      if (next > limit) break;
      end = next;
    }
    if (end > 0) return end;
    throw new Error("A single grapheme exceeds the translation input limit.");
  }
  let end = 0;
  for (const point of value) {
    if (end + point.length > limit) break;
    end += point.length;
  }
  if (end === 0) throw new Error("A single grapheme exceeds the translation input limit.");
  return end;
}

export function splitText(text: string, limit = 4000): TextChunk[] {
  if (limit < 1) throw new Error("Chunk limit must be positive.");
  const chunks: TextChunk[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    const paragraph = lastBoundary(remaining, limit, /\n\s*\n/gmu);
    const sentence = paragraph ?? lastBoundary(remaining, limit, /[.!?。！？]+["'”’)]*\s+/gmu);
    const word = sentence ?? lastBoundary(remaining, limit, /\s+/gmu);
    const end = word?.end ?? graphemeCut(remaining, limit);
    const separator = word?.separator ?? "";
    const core = remaining.slice(0, end - separator.length);
    if (!core) throw new Error("Could not make progress while splitting text.");
    chunks.push({ text: core, separator });
    remaining = remaining.slice(end);
  }
  if (remaining) chunks.push({ text: remaining, separator: "" });
  return chunks;
}

export function joinTranslatedChunks(chunks: TextChunk[], outputs: string[]): string {
  if (chunks.length !== outputs.length) throw new Error("A chunk result is missing; the unit cannot be reassembled.");
  return chunks.map((chunk, index) => `${chunk.separator ? outputs[index]!.trimEnd() : outputs[index]}${chunk.separator}`).join("");
}
