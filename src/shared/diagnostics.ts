import type { TranslationUnit } from "./dom";

export type DiagnosticOutcome = "translated" | "already-target" | "uncertain" | "detector-unsupported" | "route-missing" | "hidden" | "excluded" | "empty" | "unchanged-success" | "stale" | "cancelled" | "pseudo-content-skipped" | "failed";
export interface DiagnosticEntry {
  time: number;
  outcome: DiagnosticOutcome;
  reason?: string;
  kind: TranslationUnit["kind"];
  selector: string;
  source: string | null;
  target: string;
  sample: string;
}

export class DiagnosticBuffer {
  private entries: DiagnosticEntry[] = [];
  constructor(private capacity = 300) {}
  push(entry: DiagnosticEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
  }
  list(): DiagnosticEntry[] { return [...this.entries]; }
  clear(): void { this.entries = []; }
}

export function diagnosticFor(unit: TranslationUnit, outcome: DiagnosticOutcome, source: string | null, target: string, value = unit.getText(), reason?: string): DiagnosticEntry {
  const element = unit.element;
  const selector = element.id ? `#${element.id.slice(0, 40)}` : `${element.tagName.toLowerCase()}${[...element.classList].slice(0, 2).map((part) => `.${part.slice(0, 20)}`).join("")}`;
  return { time: Date.now(), outcome, reason: reason?.slice(0, 160), kind: unit.kind, selector: selector.slice(0, 80), source, target, sample: value.replace(/\s+/g, " ").slice(0, 80) };
}
