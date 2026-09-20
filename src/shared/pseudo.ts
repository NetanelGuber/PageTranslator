import { isDocument, isShadowRoot, type TranslationUnit } from "./dom";

type Pseudo = "before" | "after";
type StyleRoot = Document | ShadowRoot;
const ATTRIBUTE = "data-page-translator-pseudo-id";
const managers = new WeakMap<StyleRoot, PseudoManager>();
let nextId = 0;

function cssString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\a ").replaceAll("\r", "\\d ")}"`;
}

export function parseLiteralContent(value: string): string | null {
  const match = value.trim().match(/^(["'])((?:\\[\s\S]|(?!\1)[^\\])*)\1$/u);
  if (!match) return null;
  const body = match[2] ?? "";
  let result = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (char !== "\\") { result += char; continue; }
    const rest = body.slice(index + 1);
    const hex = rest.match(/^[0-9a-fA-F]{1,6}(?:\s)?/u);
    if (hex) {
      const code = Number.parseInt(hex[0].trim(), 16);
      result += code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
      index += hex[0].length;
    } else if (rest[0] && rest[0] !== "\n" && rest[0] !== "\r") {
      result += rest[0];
      index += 1;
    } else return null;
  }
  return /\p{L}/u.test(result) && !/[\ue000-\uf8ff]/u.test(result) ? result : null;
}

class PseudoManager {
  private style: HTMLStyleElement;
  private rules = new Map<string, string>();
  private ids = new WeakMap<Element, string>();

  constructor(private root: StyleRoot) {
    const doc = isDocument(root) ? root : root.ownerDocument;
    this.style = doc.createElement("style");
    this.style.setAttribute("data-page-translator-style", "");
    (isDocument(root) ? root.head ?? root.documentElement : root).append(this.style);
  }

  id(element: Element): string {
    let id = this.ids.get(element);
    if (!id) {
      id = `pt-${++nextId}`;
      this.ids.set(element, id);
    }
    return id;
  }

  set(element: Element, pseudo: Pseudo, value: string): void {
    const id = this.id(element);
    element.setAttribute(ATTRIBUTE, id);
    this.rules.set(`${id}:${pseudo}`, `[${ATTRIBUTE}="${id}"]::${pseudo}{content:${cssString(value)} !important}`);
    this.render();
  }

  remove(element: Element, pseudo: Pseudo): void {
    const id = this.ids.get(element);
    if (!id) return;
    this.rules.delete(`${id}:${pseudo}`);
    if (!this.rules.has(`${id}:before`) && !this.rules.has(`${id}:after`)) element.removeAttribute(ATTRIBUTE);
    this.render();
  }

  private render(): void { this.style.textContent = [...this.rules.values()].join("\n"); }
}

function manager(root: StyleRoot): PseudoManager {
  let value = managers.get(root);
  if (!value) { value = new PseudoManager(root); managers.set(root, value); }
  return value;
}

export function collectPseudoUnit(element: Element, pseudo: Pseudo, onSkipped?: (value: string) => void): TranslationUnit | null {
  const view = element.ownerDocument.defaultView;
  if (!view) return null;
  if (!(view as Window & { CSS?: typeof CSS }).CSS?.supports) return null;
  const style = view.getComputedStyle(element, `::${pseudo}`);
  if (/material icons|font awesome|glyphicons|bootstrap icons/i.test(style.fontFamily)) { onSkipped?.(style.content); return null; }
  const literal = parseLiteralContent(style.content);
  if (!literal) {
    if (style.content !== "none" && style.content !== "normal") onSkipped?.(style.content);
    return null;
  }
  const root = element.getRootNode() as StyleRoot;
  if (!(isDocument(root) || isShadowRoot(root))) return null;
  const owner = element;
  const field = `pseudo:${pseudo}`;
  return {
    kind: pseudo === "before" ? "pseudo-before" : "pseudo-after",
    owner, field, element, root, document: element.ownerDocument,
    getValue: () => view.getComputedStyle(element, `::${pseudo}`).content,
    setValue: () => manager(root).remove(element, pseudo),
    getText: () => parseLiteralContent(view.getComputedStyle(element, `::${pseudo}`).content) ?? "",
    setTranslation: (value) => manager(root).set(element, pseudo, value)
  };
}

export function removePseudoOverride(element: Element, pseudo?: Pseudo, knownRoot?: StyleRoot): void {
  const root = knownRoot ?? element.getRootNode();
  if (!(isDocument(root) || isShadowRoot(root))) return;
  const found = managers.get(root);
  if (!found) return;
  if (!pseudo || pseudo === "before") found.remove(element, "before");
  if (!pseudo || pseudo === "after") found.remove(element, "after");
}
