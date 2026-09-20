import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const candidates = [process.env.CHROMIUM_PATH, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "imput", "Helium", "Application", "chrome.exe"), process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")].filter(Boolean);
const executablePath = candidates.find((path) => existsSync(path));
if (!executablePath) throw new Error("No Chromium browser found.");
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  for (const count of [100, 5_000, 50_000]) {
    await page.setContent(`<!doctype html><style>.pseudo::before{content:"Texto visible"}</style><main>${'<p>Texto español de una página de prueba.</p>'.repeat(count - 1)}<p class="pseudo">Texto español de una página de prueba.</p></main>`);
    const result = await page.evaluate(() => {
      const start = performance.now();
      let textNodes = 0;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) textNodes += 1;
      const textMs = performance.now() - start;
      const elements = document.body.querySelectorAll("*");
      const visibleStart = performance.now();
      for (const element of elements) {
        for (let current = element; current; current = current.parentElement) getComputedStyle(current).display;
      }
      const visibilityWithoutCacheMs = performance.now() - visibleStart;
      const visibility = new WeakMap();
      function visible(element) {
        const cached = visibility.get(element);
        if (cached !== undefined) return cached;
        const result = getComputedStyle(element).display !== "none" && (!element.parentElement || visible(element.parentElement));
        visibility.set(element, result);
        return result;
      }
      const cachedStart = performance.now();
      for (const element of elements) visible(element);
      const visibilityWithCacheMs = performance.now() - cachedStart;
      const pseudoStart = performance.now();
      let literalCandidates = 0;
      for (const element of elements) {
        for (const pseudo of ["::before", "::after"]) {
          const value = getComputedStyle(element, pseudo).content;
          if (value !== "none" && value !== "normal") literalCandidates += 1;
        }
      }
      return { textNodes, elements: elements.length, textMs: +textMs.toFixed(1), visibilityWithoutCacheMs: +visibilityWithoutCacheMs.toFixed(1), visibilityWithCacheMs: +visibilityWithCacheMs.toFixed(1), pseudoMs: +(performance.now() - pseudoStart).toFixed(1), literalCandidates };
    });
    process.stdout.write(`${JSON.stringify({ count, ...result })}\n`);
  }
} finally {
  await browser.close();
}
