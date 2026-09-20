import { collectPseudoUnit } from "./pseudo";

export const EXTENSION_HOST_ID = "page-translator-extension-root";
export function isDocument(node: Node): node is Document { return node.nodeType === Node.DOCUMENT_NODE; }
export function isShadowRoot(node: Node): node is ShadowRoot { return node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && "host" in node; }
export function isElement(node: Node): node is Element { return node.nodeType === Node.ELEMENT_NODE; }

const EXECUTABLE_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
const NORMAL_SKIP_TAGS = new Set(["CODE", "PRE", "KBD", "SAMP"]);
const READABLE_ATTRIBUTES = ["title", "alt", "placeholder", "aria-label"] as const;

export interface TranslationUnit {
  kind: "text-node" | "readable-attribute" | "document-title" | "pseudo-before" | "pseudo-after";
  owner: Node;
  field: string;
  element: Element;
  root: Document | ShadowRoot;
  document: Document;
  getValue(): string;
  setValue(value: string): void;
  getText(): string;
  setTranslation(value: string): void;
}

export type UnitSkip = (outcome: "hidden" | "excluded" | "empty" | "pseudo-content-skipped", kind: TranslationUnit["kind"], element: Element, sample: string) => void;
export interface ScanStats { nodesVisited: number; pseudoStyleReads: number; }

function parentOf(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  if (isShadowRoot(root)) return root.host;
  const frame = element.ownerDocument.defaultView?.frameElement;
  return frame && isElement(frame) ? frame : null;
}

export function restoreIfUnchanged(unit: TranslationUnit, original: string, translated: string): boolean {
  if (unit.getValue() !== translated) return false;
  unit.setValue(original);
  return true;
}

function hasLetters(value: string): boolean {
  return /\p{L}/u.test(value);
}

function trimmedParts(value: string): { prefix: string; core: string; suffix: string } {
  const match = value.match(/^(\s*)([\s\S]*?\S)(\s*)$/u);
  return match ? { prefix: match[1] ?? "", core: match[2] ?? "", suffix: match[3] ?? "" } : { prefix: "", core: "", suffix: "" };
}

function isEditable(element: Element): boolean {
  if (element.closest("textarea, select")) return true;
  const editable = element.closest("[contenteditable]");
  return editable !== null && editable.getAttribute("contenteditable")?.toLowerCase() !== "false";
}

function isPasswordField(element: Element): boolean {
  return element.tagName === "INPUT" && element.getAttribute("type")?.toLowerCase() === "password";
}

function hasExcludedAncestor(element: Element, aggressive: boolean): boolean {
  for (let current: Element | null = element; current; current = parentOf(current)) {
    if (current.id === EXTENSION_HOST_ID) return true;
    if (EXECUTABLE_TAGS.has(current.tagName)) return true;
    if (!aggressive && NORMAL_SKIP_TAGS.has(current.tagName)) return true;
  }
  return false;
}

export function isElementVisible(element: Element, cache?: WeakMap<Element, boolean>): boolean {
  const cached = cache?.get(element);
  if (cached !== undefined) return cached;
  let visible = !element.hasAttribute("hidden") && element.getAttribute("aria-hidden")?.toLowerCase() !== "true";
  if (visible) {
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    visible = !style || (style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0");
  }
  if (visible) {
    const parent = parentOf(element);
    if (parent) visible = isElementVisible(parent, cache);
  }
  cache?.set(element, visible);
  return visible;
}

function textUnit(node: Text): TranslationUnit | null {
  const element = node.parentElement;
  if (!element) return null;
  const parts = trimmedParts(node.data);
  if (!parts.core || !hasLetters(parts.core)) return null;
  return {
    kind: "text-node",
    owner: node,
    field: "textContent",
    element,
    root: node.getRootNode() as Document | ShadowRoot,
    document: node.ownerDocument,
    getValue: () => node.data,
    setValue: (value) => { node.data = value; },
    getText: () => trimmedParts(node.data).core,
    setTranslation: (value) => {
      const current = trimmedParts(node.data);
      node.data = `${current.prefix}${value}${current.suffix}`;
    }
  };
}

function attributeUnit(element: Element, attribute: string): TranslationUnit | null {
  const current = element.getAttribute(attribute) ?? "";
  const parts = trimmedParts(current);
  if (!parts.core || !hasLetters(parts.core)) return null;
  return {
    kind: "readable-attribute",
    owner: element,
    field: `attribute:${attribute}`,
    element,
    root: element.getRootNode() as Document | ShadowRoot,
    document: element.ownerDocument,
    getValue: () => element.getAttribute(attribute) ?? "",
    setValue: (value) => { element.setAttribute(attribute, value); },
    getText: () => trimmedParts(element.getAttribute(attribute) ?? "").core,
    setTranslation: (value) => {
      const latest = trimmedParts(element.getAttribute(attribute) ?? "");
      element.setAttribute(attribute, `${latest.prefix}${value}${latest.suffix}`);
    }
  };
}

function titleUnit(document: Document): TranslationUnit | null {
  if (!document.title.trim() || !hasLetters(document.title)) return null;
  return {
    kind: "document-title",
    owner: document,
    field: "document:title",
    element: document.querySelector("title") ?? document.documentElement,
    root: document,
    document,
    getValue: () => document.title,
    setValue: (value) => { document.title = value; },
    getText: () => document.title.trim(),
    setTranslation: (value) => { document.title = value; }
  };
}

export function collectTranslationUnitsFrom(root: Document | ShadowRoot | Element, aggressive = false, includeTitle = false, onSkip?: UnitSkip, stats?: ScanStats, visibility = new WeakMap<Element, boolean>()): TranslationUnit[] {
  const units: TranslationUnit[] = [];
  const scanRoot = isDocument(root) ? root.body : root;
  if (!scanRoot) return units;
  const document = scanRoot.ownerDocument ?? root as Document;

  const walker = document.createTreeWalker(scanRoot, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (stats) stats.nodesVisited += 1;
    const text = node as Text;
    const element = text.parentElement;
    if (!element) continue;
    if (hasExcludedAncestor(element, aggressive) || isEditable(element) || isPasswordField(element)) { onSkip?.("excluded", "text-node", element, text.data); continue; }
    if (!aggressive && !isElementVisible(element, visibility)) { onSkip?.("hidden", "text-node", element, text.data); continue; }
    const unit = textUnit(text);
    if (unit) units.push(unit);
    else onSkip?.("empty", "text-node", element, text.data);
  }

  const elements = [
    ...(isElement(scanRoot) ? [scanRoot] : []),
    ...scanRoot.querySelectorAll("*")
  ];
  for (const element of elements) {
    if (stats) stats.nodesVisited += 1;
    if (hasExcludedAncestor(element, aggressive) || isEditable(element) || isPasswordField(element)) { onSkip?.("excluded", "readable-attribute", element, ""); continue; }
    if (!aggressive && !isElementVisible(element, visibility)) { onSkip?.("hidden", "readable-attribute", element, ""); continue; }
    for (const attribute of READABLE_ATTRIBUTES) {
      if (!element.hasAttribute(attribute)) continue;
      const unit = attributeUnit(element, attribute);
      if (unit) units.push(unit);
      else onSkip?.("empty", "readable-attribute", element, element.getAttribute(attribute) ?? "");
    }
    if (stats) stats.pseudoStyleReads += 2;
    const before = collectPseudoUnit(element, "before", (value) => onSkip?.("pseudo-content-skipped", "pseudo-before", element, value));
    const after = collectPseudoUnit(element, "after", (value) => onSkip?.("pseudo-content-skipped", "pseudo-after", element, value));
    if (before) units.push(before);
    if (after) units.push(after);
  }

  if (includeTitle && isDocument(root)) {
    const pageTitle = titleUnit(root);
    if (pageTitle) units.push(pageTitle);
  }
  return units;
}

export function discoverAccessibleRoots(document: Document): Array<Document | ShadowRoot> {
  const roots: Array<Document | ShadowRoot> = [];
  const seen = new Set<Document | ShadowRoot>();
  function visit(root: Document | ShadowRoot): void {
    if (seen.has(root)) return;
    seen.add(root);
    roots.push(root);
    for (const element of root.querySelectorAll("*")) {
      if (element.id === EXTENSION_HOST_ID) continue;
      if (element.shadowRoot) visit(element.shadowRoot);
      if (element.tagName === "IFRAME") {
        const frame = element as HTMLIFrameElement;
        try { if (frame.contentDocument && frame.contentDocument.documentElement) visit(frame.contentDocument); }
        catch { /* Cross-origin documents are inaccessible. */ }
      }
    }
  }
  visit(document);
  return roots;
}

export function collectTranslationUnits(document: Document, aggressive = false, onSkip?: UnitSkip, stats?: ScanStats): TranslationUnit[] {
  const visibility = new WeakMap<Element, boolean>();
  return discoverAccessibleRoots(document).flatMap((root) => collectTranslationUnitsFrom(root, aggressive, isDocument(root), onSkip, stats, visibility));
}

export function collectTranslationUnitsInSubtree(root: Document | ShadowRoot | Element, aggressive = false, onSkip?: UnitSkip, stats?: ScanStats): { units: TranslationUnit[]; roots: Array<Document | ShadowRoot> } {
  const units: TranslationUnit[] = [];
  const roots: Array<Document | ShadowRoot> = [];
  const seen = new Set<Node>();
  const visibility = new WeakMap<Element, boolean>();
  function visit(current: Document | ShadowRoot | Element): void {
    if (seen.has(current)) return;
    seen.add(current);
    units.push(...collectTranslationUnitsFrom(current, aggressive, isDocument(current), onSkip, stats, visibility));
    if (isDocument(current) || isShadowRoot(current)) roots.push(current);
    const elements = [
      ...(isElement(current) ? [current] : []),
      ...current.querySelectorAll("*")
    ];
    for (const element of elements) {
      if (element.id === EXTENSION_HOST_ID) continue;
      if (element.shadowRoot) visit(element.shadowRoot);
      if (element.tagName === "IFRAME") {
        try {
          const frameDocument = (element as HTMLIFrameElement).contentDocument;
          if (frameDocument?.documentElement) visit(frameDocument);
        } catch { /* Cross-origin frame. */ }
      }
    }
  }
  visit(root);
  return { units, roots };
}

export function closestDeclaredLanguage(element: Element): string {
  return element.closest("[lang]")?.getAttribute("lang")?.trim() ?? "";
}

export function getBlockText(element: Element): string {
  const block = element.closest("p, li, blockquote, figcaption, td, th, button, label, h1, h2, h3, h4, h5, h6, article, section, nav");
  return (block?.textContent ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
}
