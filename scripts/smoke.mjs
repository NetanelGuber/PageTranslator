import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const execFileAsync = promisify(execFile);

const extensionPath = resolve("dist");
const stressIntervals = Math.max(1, Number(process.env.STRESS_INTERVALS ?? 10));
const candidates = [
  process.env.CHROMIUM_PATH,
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "imput", "Helium", "Application", "chrome.exe"),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
].filter(Boolean);
const executablePath = candidates.find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error("No compatible Chromium executable found. Set CHROMIUM_PATH and rerun npm run smoke.");
if (!existsSync(join(extensionPath, "manifest.json"))) throw new Error("dist/ is missing. Run npm run build before npm run smoke.");

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen(server.address().port));
  });
}

function close(server) { return new Promise((resolveClose) => server.close(resolveClose)); }

const crossServer = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end('<!doctype html><html><body><p id="cross-text" lang="es">Este documento extranjero contiene suficiente texto español para una prueba.</p></body></html>');
});
const crossPort = await listen(crossServer);

async function profileWorkingSetBytes(profile) {
  if (process.platform !== "win32") return 0;
  const safeProfile = profile.replaceAll("'", "''");
  const command = `$p='${safeProfile}'; $n=(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like ('*'+$p+'*') } | Measure-Object -Property WorkingSetSize -Sum).Sum; if ($null -eq $n) { 0 } else { $n }`;
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command]);
  return Number(stdout.trim()) || 0;
}

const pageServer = createServer((request, response) => {
  if (request.url === "/frame" || request.url === "/frame2") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><body><p id="frame-text" lang="es">${request.url === "/frame" ? "Esta página enmarcada contiene suficiente texto español para comprobar la traducción." : "Esta nueva página enmarcada contiene contenido español después de navegar."}</p></body></html>`);
    return;
  }
  if (request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><title lang="es">Página de prueba</title><style id="fixture-style">
      #pseudo-before::before { content: "Configuración de la cuenta y preferencias"; }
      #pseudo-before.alt::before { content: "Administración de perfiles de usuario"; }
      #pseudo-before.none::before { content: none; }
      #pseudo-after::after { content: "Notificaciones recientes de la cuenta"; }
      #russian-before::before { content: "Настройки учетной записи и уведомления"; }
      #japanese-after::after { content: "アカウント設定と通知を確認してください"; }
      #arabic-before::before { content: "إعدادات الحساب والإشعارات المتاحة"; direction: rtl; }
      #icon::before { content: "\\e001"; }
    </style></head><body>
      <main>
        <p id="english" lang="en">This paragraph is already in English and must remain unchanged.</p>
        <p id="spanish-one" lang="es">Esta página contiene suficiente texto en español para solicitar una traducción completa.</p>
        <p id="spanish-two" lang="es">También contiene una segunda oración que confirma claramente el idioma extranjero.</p>
        <p id="race" lang="es">Esta oración española inicial debe permanecer protegida contra un resultado tardío.</p>
        <div id="large">${"<span>HD</span>".repeat(5000)}</div>
        <p id="mixed-label"><span id="english-label">Arabic:</span><span id="spanish-body" lang="es">Esta oración española contiene suficientes palabras para verificar que el texto extranjero se traduce sin cambiar la etiqueta.</span></p>
        <p id="pseudo-before"></p><p id="pseudo-after"></p><p id="icon"></p>
        <p id="russian-before" lang="ru"></p><p id="japanese-after" lang="ja"></p><p id="arabic-before" lang="ar"></p>
        <div id="shadow-host"></div><iframe id="same-origin-frame" src="/frame"></iframe><iframe id="cross-origin-frame" src="http://127.0.0.1:${crossPort}/"></iframe>
        <div id="dynamic"></div>
      </main>
      <script>
        const root = document.querySelector('#shadow-host').attachShadow({mode:'open'});
        root.innerHTML = '<p id="shadow-text" lang="es">Esta raíz de sombra contiene suficiente texto español para comprobar la traducción.</p><div id="nested-host"></div>';
        root.querySelector('#nested-host').attachShadow({mode:'open'}).innerHTML = '<p id="nested-text" lang="es">Esta raíz anidada contiene suficiente texto español para comprobar la traducción.</p>';
      </script>
    </body></html>`);
    return;
  }
  response.writeHead(404).end();
});

const pagePort = await listen(pageServer);
const profilePath = await mkdtemp(join(tmpdir(), "page-translator-smoke-"));
let context;

try {
  context = await chromium.launchPersistentContext(profilePath, {
    executablePath,
    headless: process.env.SMOKE_HEADLESS === "1",
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.locator("#target-language:not(:disabled)").waitFor({ timeout: 15_000 });
  await options.locator("#target-language").selectOption("en");
  await options.locator("#save").click();
  await options.getByText("Settings saved.").waitFor();
  const catalogRepair = await options.evaluate(async () => {
    await chrome.storage.local.set({ languageCatalogVersion: "stale", languageCatalog: [{ code: "zz", name: "Stale", targets: [] }] });
    const info = await chrome.runtime.sendMessage({ type: "GET_ENGINE_INFO" });
    const stored = await chrome.storage.local.get(["languageCatalogVersion", "languageCatalog", "translatorSettings"]);
    const registry = await (await fetch(chrome.runtime.getURL("models.json"))).json();
    return { info, stored, generated: registry.generated };
  });
  if (!catalogRepair.info?.ok || catalogRepair.stored.languageCatalogVersion !== catalogRepair.generated ||
      catalogRepair.stored.translatorSettings?.targetLanguage !== "en" ||
      !catalogRepair.stored.languageCatalog.some((language) => language.code === "en") ||
      catalogRepair.stored.languageCatalog.some((language) => language.code === "zz")) {
    throw new Error(`Bundled catalog repair did not preserve the saved target: ${JSON.stringify(catalogRepair)}`);
  }
  await options.evaluate(() => {
    window.__enginePhases = [];
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "ENGINE_PROGRESS") window.__enginePhases.push(message.phase);
    });
  });
  await options.evaluate(async () => chrome.storage.local.set({ developerDiagnostics: true }));

  const fixture = await context.newPage();
  const fixtureUrl = `http://127.0.0.1:${pagePort}/`;
  await fixture.goto(fixtureUrl);
  const banner = fixture.locator("#page-translator-extension-root").locator("button", { hasText: "Translate" });
  await banner.waitFor({ timeout: 15_000 });

  const requestsBeforeConsent = await fixture.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
  if (requestsBeforeConsent.some((url) => url.includes("translations-data"))) throw new Error("A model was requested before translation consent.");
  const contextsBeforeConsent = await options.evaluate(async () => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }));
  if (contextsBeforeConsent.length !== 0) throw new Error("The translation engine started before translation consent.");
  const baselineWorkingSet = await profileWorkingSetBytes(profilePath);
  let peakWorkingSet = baselineWorkingSet;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      peakWorkingSet = Math.max(peakWorkingSet, await profileWorkingSetBytes(profilePath));
      await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    }
  })();
  await banner.click();
  const earlyTabId = await options.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id);
  await options.waitForFunction(async (tabId) => (await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_STATE" }))?.phase === "translating", earlyTabId, { timeout: 15_000 });
  await fixture.locator("#race").evaluate((element) => { element.textContent = "Website supplied newer text during translation."; });
  await fixture.evaluate(() => {
    const labels = [
      "Configuración de la cuenta",
      "Mis colecciones guardadas",
      "Mis listas de reproducción",
      "Mis subtítulos disponibles",
      "Mis notificaciones recientes",
      "Cerrar la sesión actual"
    ];
    labels.forEach((label, index) => {
      window.setTimeout(() => {
        const item = document.createElement("p");
        item.id = `menu-spanish-${index}`;
        item.lang = "es";
        item.textContent = label;
        document.querySelector("#dynamic")?.append(item);
      }, index * 80);
    });
  });
  await fixture.waitForFunction(() => {
    const text = document.querySelector("#spanish-one")?.textContent ?? "";
    return !text.startsWith("Esta página") && text.length > 10;
  }, undefined, { timeout: 180_000 });
  const translated = await fixture.locator("#spanish-one").textContent();
  if (!translated?.toLowerCase().includes("page")) throw new Error(`Unexpected Spanish translation: ${translated}`);
  await fixture.waitForFunction(() => {
    const text = document.querySelector("#menu-spanish-5")?.textContent ?? "";
    return Boolean(text) && !text.startsWith("Cerrar la sesión");
  }, undefined, { timeout: 180_000 });
  sampling = false;
  await sampler;
  const english = await fixture.locator("#english").textContent();
  if (english !== "This paragraph is already in English and must remain unchanged.") throw new Error("Target-language text was modified.");
  if (await fixture.locator("#english-label").textContent() !== "Arabic:") throw new Error("An uncertain Latin label inherited its foreign sibling's language.");
  if ((await fixture.locator("#spanish-body").textContent())?.startsWith("Esta oración")) throw new Error("The foreign sibling did not translate.");
  if (await fixture.locator("#race").textContent() !== "Website supplied newer text during translation.") throw new Error("A late translation overwrote a site edit.");
  await fixture.waitForFunction(() => { const value = getComputedStyle(document.querySelector("#pseudo-before"), "::before").content; return value !== "none" && value !== "normal" && !value.includes("Configuración"); }, undefined, { timeout: 30_000 });
  await fixture.waitForFunction(() => { const value = getComputedStyle(document.querySelector("#pseudo-after"), "::after").content; return value !== "none" && value !== "normal" && !value.includes("Notificaciones"); }, undefined, { timeout: 30_000 });
  await fixture.waitForFunction(() => { const value = getComputedStyle(document.querySelector("#russian-before"), "::before").content; return value !== "none" && !value.includes("Настройки"); }, undefined, { timeout: 30_000 }).catch(async (error) => {
    const debug = await options.evaluate(async (tabId) => ({ state: await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_STATE" }), diagnostics: await chrome.tabs.sendMessage(tabId, { type: "GET_DIAGNOSTICS" }) }), earlyTabId);
    process.stderr.write(`Russian pseudo debug: ${JSON.stringify({ state: debug.state, scan: debug.diagnostics.lastScan, entries: debug.diagnostics.entries.filter((entry) => entry.selector === '#russian-before').slice(-10), content: await fixture.evaluate(() => getComputedStyle(document.querySelector('#russian-before'), '::before').content) })}\n`);
    throw error;
  });
  await fixture.waitForFunction(() => { const value = getComputedStyle(document.querySelector("#arabic-before"), "::before").content; return value !== "none" && !value.includes("إعدادات"); }, undefined, { timeout: 180_000 });
  const earlyDiagnostics = await options.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, { type: "GET_DIAGNOSTICS" }), earlyTabId);
  const enginePhases = await options.evaluate(() => [...new Set(window.__enginePhases)]);
  if (!["downloading", "verifying", "loading", "translating"].every((phase) => enginePhases.includes(phase))) {
    throw new Error(`Missing model progress phases: ${JSON.stringify(enginePhases)}`);
  }
  if (!earlyDiagnostics?.enabled || !earlyDiagnostics.entries.some((entry) => entry.kind === "pseudo-after" && entry.outcome === "route-missing" && entry.source === "ja") || !earlyDiagnostics.entries.some((entry) => entry.kind === "pseudo-before" && entry.outcome === "translated" && entry.source === "ru")) {
    throw new Error(`Pseudo diagnostics did not distinguish translated and route-missing text: ${JSON.stringify(earlyDiagnostics?.entries.filter((entry) => entry.kind.startsWith("pseudo")).slice(-20))}`);
  }
  if (!(await fixture.evaluate(() => getComputedStyle(document.querySelector("#japanese-after"), "::after").content)).includes("アカウント")) throw new Error("A Japanese pseudo with no Release model route was overwritten.");
  if (await fixture.evaluate(() => getComputedStyle(document.querySelector("#arabic-before"), "::before").direction) !== "rtl") throw new Error("RTL pseudo direction was lost.");
  await fixture.waitForFunction(() => !document.querySelector("#shadow-host").shadowRoot.querySelector("#shadow-text").textContent.startsWith("Esta raíz"), undefined, { timeout: 30_000 });
  await fixture.waitForFunction(() => !document.querySelector("#shadow-host").shadowRoot.querySelector("#nested-host").shadowRoot.querySelector("#nested-text").textContent.startsWith("Esta raíz"), undefined, { timeout: 30_000 });
  await fixture.waitForFunction(() => !document.querySelector("#same-origin-frame").contentDocument.querySelector("#frame-text").textContent.startsWith("Esta página"), undefined, { timeout: 30_000 });
  if (await fixture.evaluate(() => document.querySelector("#cross-origin-frame").contentDocument !== null)) throw new Error("Cross-origin fixture unexpectedly exposed its document.");
  if ((await fixture.evaluate(() => getComputedStyle(document.querySelector("#icon"), "::before").content)).includes("translated")) throw new Error("Icon pseudo content was translated.");
  const originalSiteStyle = await fixture.locator("#fixture-style").textContent();
  const translatedPseudoBefore = await fixture.evaluate(() => getComputedStyle(document.querySelector("#pseudo-before"), "::before").content);
  await fixture.locator("#pseudo-before").evaluate((element) => element.classList.add("alt"));
  await fixture.waitForFunction((previous) => { const value = getComputedStyle(document.querySelector("#pseudo-before"), "::before").content; return value !== previous && value !== "none" && !value.includes("Administración"); }, translatedPseudoBefore, { timeout: 30_000 });
  await fixture.locator("#pseudo-before").evaluate((element) => element.classList.add("none"));
  await fixture.waitForFunction(() => getComputedStyle(document.querySelector("#pseudo-before"), "::before").content === "none", undefined, { timeout: 30_000 });
  await fixture.locator("#same-origin-frame").evaluate((element) => { element.src = "/frame2"; });
  await fixture.waitForFunction(() => { const frame = document.querySelector("#same-origin-frame"); const text = frame.contentDocument?.querySelector("#frame-text")?.textContent; return frame.contentWindow?.location.pathname === "/frame2" && Boolean(text) && !text.startsWith("Esta nueva"); }, undefined, { timeout: 30_000 });

  await fixture.locator("#dynamic").evaluate((element) => {
    const paragraph = document.createElement("p");
    paragraph.id = "new-spanish";
    paragraph.lang = "es";
    paragraph.textContent = "Este contenido dinámico también debe traducirse automáticamente después de aparecer.";
    element.append(paragraph);
  });
  await fixture.waitForFunction(() => {
    const text = document.querySelector("#new-spanish")?.textContent ?? "";
    return !text.startsWith("Este contenido") && text.length > 10;
  }, undefined, { timeout: 180_000 });
  const smallScan = await options.evaluate(async (tabId) => (await chrome.tabs.sendMessage(tabId, { type: "GET_DIAGNOSTICS" })).lastScan, earlyTabId);
  if (smallScan.scope !== "dirty" || smallScan.nodesVisited > 100) throw new Error(`A small DOM update caused a broad rescan: ${JSON.stringify(smallScan)}`);
  const stressBeforeMemory = await profileWorkingSetBytes(profilePath);
  const stressBeforeMetrics = await options.evaluate(async (tabId) => (await chrome.tabs.sendMessage(tabId, { type: "GET_DIAGNOSTICS" })).metrics, earlyTabId);
  for (let interval = 0; interval < stressIntervals; interval += 1) {
    await fixture.evaluate((index) => {
      let holder = document.querySelector("#stress");
      if (!holder) { holder = document.createElement("section"); holder.id = "stress"; document.querySelector("#dynamic").append(holder); }
      if (index > 0) for (const node of holder.querySelectorAll(`[data-interval="${index - 1}"]`)) node.textContent = "Notificaciones recientes de la cuenta";
      const batch = document.createDocumentFragment();
      for (let item = 0; item < 100; item += 1) {
        const node = document.createElement("p");
        node.lang = "es";
        node.dataset.interval = String(index);
        node.textContent = "Configuración de la cuenta y preferencias";
        batch.append(node);
      }
      holder.append(batch);
    }, interval);
    await fixture.waitForFunction((index) => {
      const nodes = document.querySelectorAll(`#stress [data-interval="${index}"]`);
      return nodes.length === 100 && [...nodes].every((node) => !node.textContent.startsWith("Configuración"));
    }, interval, { timeout: 30_000 });
  }
  const stressAfterMemory = await profileWorkingSetBytes(profilePath);
  const stressAfterMetrics = await options.evaluate(async (tabId) => (await chrome.tabs.sendMessage(tabId, { type: "GET_DIAGNOSTICS" })).metrics, earlyTabId);
  if (stressAfterMetrics.cacheHits <= stressBeforeMetrics.cacheHits || stressAfterMetrics.cacheEntries > 3000 || stressAfterMetrics.recordCount > stressIntervals * 100 + 200) {
    throw new Error(`Dynamic stress exceeded a bound or did not use cached translations: ${JSON.stringify({ stressBeforeMetrics, stressAfterMetrics })}`);
  }
  const longOriginal = ("Esta sección contiene información importante en español para verificar la traducción de párrafos extensos.\n\n").repeat(220);
  await fixture.locator("#dynamic").evaluate((element, value) => {
    const paragraph = document.createElement("p");
    paragraph.id = "long-node";
    paragraph.lang = "es";
    paragraph.textContent = value;
    element.append(paragraph);
  }, longOriginal);
  await fixture.waitForFunction(() => { const value = document.querySelector("#long-node")?.textContent ?? ""; return value.length > 10_000 && !value.startsWith("Esta sección"); }, undefined, { timeout: 180_000 });
  await fixture.evaluate(() => { window.detachedTextForTest = document.querySelector("#spanish-one"); window.detachedTextForTest.remove(); });
  await fixture.waitForTimeout(250);
  await fixture.evaluate(() => { document.querySelector("main").append(window.detachedTextForTest); delete window.detachedTextForTest; });
  await fixture.waitForFunction(() => { const value = document.querySelector("#spanish-one")?.textContent ?? ""; return value.length > 10 && !value.startsWith("Esta página"); }, undefined, { timeout: 30_000 });
  await fixture.evaluate(() => { window.detachedPseudoForTest = document.querySelector("#pseudo-after"); window.detachedPseudoForTest.remove(); });
  await fixture.waitForFunction(() => !window.detachedPseudoForTest.hasAttribute("data-page-translator-pseudo-id"), undefined, { timeout: 10_000 });
  await fixture.evaluate(() => { document.querySelector("main").append(window.detachedPseudoForTest); delete window.detachedPseudoForTest; });
  await fixture.waitForFunction(() => { const value = getComputedStyle(document.querySelector("#pseudo-after"), "::after").content; return value !== "none" && !value.includes("Notificaciones"); }, undefined, { timeout: 30_000 });

  const memoryResult = await options.evaluate(async () => chrome.runtime.sendMessage({
    type: "TRANSLATE_BATCH",
    requestId: crypto.randomUUID(),
    source: "es",
    target: "en",
    texts: ["Esta es una prueba de memoria para la traducción local."]
  }));
  if (!memoryResult?.ok || !memoryResult.memory?.peakWasmHeapBytes) {
    throw new Error(`Engine memory diagnostics failed: ${JSON.stringify(memoryResult)}`);
  }
  const pivotResult = await options.evaluate(async () => chrome.runtime.sendMessage({
    type: "TRANSLATE_BATCH",
    requestId: crypto.randomUUID(),
    source: "es",
    target: "fr",
    texts: ["Esta es una prueba de traducción mediante un idioma intermedio."]
  }));
  if (!pivotResult?.ok || !pivotResult.translatedTexts?.[0] || pivotResult.translatedTexts[0].startsWith("Esta es")) {
    throw new Error(`Sequential pivot translation failed: ${JSON.stringify(pivotResult)}`);
  }
  const pivotPhases = await options.evaluate(() => [...new Set(window.__enginePhases)]);
  if (!pivotPhases.includes("pivoting")) throw new Error(`Pivot progress phase was missing: ${JSON.stringify(pivotPhases)}`);
  const queueCancellation = await options.evaluate(async () => {
    const firstId = crypto.randomUUID();
    const queuedId = crypto.randomUUID();
    const text = "Esta es una prueba de cancelación en español. ".repeat(80);
    const first = chrome.runtime.sendMessage({ type: "TRANSLATE_BATCH", requestId: firstId, source: "es", target: "fr", texts: [text] });
    const queued = chrome.runtime.sendMessage({ type: "TRANSLATE_BATCH", requestId: queuedId, source: "es", target: "en", texts: [text] });
    await chrome.runtime.sendMessage({ type: "CANCEL_REQUESTS", requestIds: [queuedId] });
    return { first: await first, queued: await queued };
  });
  if (!queueCancellation.first?.ok || queueCancellation.queued?.code !== "CANCELLED") {
    throw new Error(`Queued cancellation affected a different request: ${JSON.stringify(queueCancellation)}`);
  }
  const activeCancellation = await options.evaluate(async () => {
    const requestId = crypto.randomUUID();
    const pending = chrome.runtime.sendMessage({ type: "TRANSLATE_BATCH", requestId, source: "ru", target: "en", texts: ["Это длинная русская фраза для проверки отмены перевода. ".repeat(60)] });
    await new Promise((resolveWait) => setTimeout(resolveWait, 30));
    await chrome.runtime.sendMessage({ type: "CANCEL_REQUESTS", requestIds: [requestId] });
    return pending;
  });
  if (activeCancellation?.code !== "CANCELLED") throw new Error(`Active cancellation failed: ${JSON.stringify(activeCancellation)}`);
  const afterCancellation = await options.evaluate(async () => chrome.runtime.sendMessage({ type: "TRANSLATE_BATCH", requestId: crypto.randomUUID(), source: "es", target: "en", texts: ["Esta traducción debe funcionar después de cancelar otra solicitud."] }));
  if (!afterCancellation?.ok) throw new Error(`A cancelled request corrupted later work: ${JSON.stringify(afterCancellation)}`);

  await fixture.bringToFront();
  const fixtureTabId = await options.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id);
  if (!fixtureTabId) throw new Error("Could not locate fixture tab for popup-control test.");
  const diagnostics = await options.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, { type: "GET_DIAGNOSTICS" }), fixtureTabId);
  if (!diagnostics?.enabled || diagnostics.entries.length > 300 || diagnostics.metrics.cacheEntries > 3000) throw new Error("Developer diagnostics or translation cache exceeded its bound.");
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await options.evaluate(async (tabId) => { await chrome.tabs.update(tabId, { active: true }); }, fixtureTabId);
  await popup.reload();
  await popup.locator("#restore:not(:disabled)").waitFor({ timeout: 10_000 });
  await popup.locator("#translate-new:not(:disabled)").click();
  const newContentStatus = await popup.locator("#status").innerText();
  if (!/No new or changed|Translated \d+ text item/.test(newContentStatus)) throw new Error(`New-content control did not report its work: ${newContentStatus}`);
  await popup.locator("#restore").click();
  await fixture.locator("#spanish-one").getByText(/^Esta página/).waitFor({ timeout: 10_000 });
  if (await fixture.evaluate(() => getComputedStyle(document.querySelector("#pseudo-before"), "::before").content) !== "none") throw new Error("Removed pseudo text reappeared during restore.");
  if (!(await fixture.evaluate(() => getComputedStyle(document.querySelector("#pseudo-after"), "::after").content)).includes("Notificaciones")) throw new Error("Pseudo after text did not restore.");
  if (!(await fixture.evaluate(() => getComputedStyle(document.querySelector("#russian-before"), "::before").content)).includes("Настройки")) throw new Error("Russian pseudo text did not restore.");
  if (!(await fixture.evaluate(() => getComputedStyle(document.querySelector("#arabic-before"), "::before").content)).includes("إعدادات")) throw new Error("Arabic pseudo text did not restore.");
  if (await fixture.locator("#fixture-style").textContent() !== originalSiteStyle) throw new Error("The site's stylesheet was modified.");
  if (!(await fixture.evaluate(() => document.querySelector("#shadow-host").shadowRoot.querySelector("#shadow-text").textContent)).startsWith("Esta raíz")) throw new Error("Shadow text was not restored.");
  if (!(await fixture.evaluate(() => document.querySelector("#same-origin-frame").contentDocument.querySelector("#frame-text").textContent)).startsWith("Esta nueva")) throw new Error("Frame text was not restored.");
  if (await fixture.locator("#long-node").textContent() !== longOriginal) throw new Error("A 20,000-character node did not restore exactly.");

  await fixture.locator("#dynamic").evaluate((element) => {
    const holder = document.createElement("section");
    holder.id = "switch-test";
    holder.innerHTML = Array.from({ length: 60 }, (_, index) => `<p lang="es">Esta oración española número ${index} contiene suficiente texto para una prueba de cambio de idioma.</p>`).join("")
      + '<p id="switch-head" lang="es">Esta es una prueba de traducción mediante un idioma intermedio.</p>';
    element.append(holder);
  });
  await options.evaluate((tabId) => { void chrome.tabs.sendMessage(tabId, { type: "TRANSLATE_PAGE" }); }, fixtureTabId);
  await options.waitForFunction(async (tabId) => (await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_STATE" }))?.phase === "translating", fixtureTabId, { timeout: 15_000 });
  await options.evaluate(async () => chrome.storage.local.set({ translatorSettings: { targetLanguage: "fr" } }));
  await fixture.waitForFunction((expected) => document.querySelector("#switch-head")?.textContent === expected, pivotResult.translatedTexts[0], { timeout: 180_000 });
  await options.waitForTimeout(700);
  if (await fixture.locator("#switch-head").textContent() !== pivotResult.translatedTexts[0]) throw new Error("A superseded English result overwrote the French target.");
  const switchedState = await options.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_STATE" }), fixtureTabId);
  if (switchedState.targetLanguage !== "fr") throw new Error(`Target change did not reach the page: ${JSON.stringify(switchedState)}`);

  await options.evaluate(async ({ tabId, hostname }) => {
    const { sitePreferences = {} } = await chrome.storage.local.get("sitePreferences");
    sitePreferences[hostname] = { alwaysTranslate: true, neverTranslate: false, sourceLanguage: "es" };
    await chrome.storage.local.set({ sitePreferences });
    await chrome.tabs.sendMessage(tabId, { type: "PREFERENCES_CHANGED", sourceChanged: true });
  }, { tabId: fixtureTabId, hostname: "127.0.0.1" });
  await fixture.waitForFunction(() => {
    const text = document.querySelector("#spanish-one")?.textContent ?? "";
    return !text.startsWith("Esta página") && text.length > 10;
  }, undefined, { timeout: 180_000 });
  await fixture.reload();
  await fixture.waitForFunction(() => {
    const text = document.querySelector("#spanish-one")?.textContent ?? "";
    return !text.startsWith("Esta página") && text.length > 10;
  }, undefined, { timeout: 180_000 });
  if (await fixture.locator("#page-translator-extension-root").count()) {
    throw new Error("Always-translate showed a consent prompt after reload.");
  }
  const forcedSourceState = await options.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_STATE" }), fixtureTabId);
  if (forcedSourceState.detectedLanguages.length !== 1 || forcedSourceState.detectedLanguages[0] !== "es") {
    throw new Error(`Explicit source-language override was not retained: ${JSON.stringify(forcedSourceState)}`);
  }
  await options.evaluate(async () => chrome.storage.local.set({ translatorSettings: { targetLanguage: "zz" } }));
  await options.waitForFunction(async (tabId) => {
    const state = await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_STATE" });
    return state?.phase === "setup" && state.message.includes("no route");
  }, fixtureTabId, { timeout: 15_000 });
  const preservedPreferences = await options.evaluate(async () => (await chrome.storage.local.get("sitePreferences")).sitePreferences["127.0.0.1"]);
  if (preservedPreferences?.sourceLanguage !== "es" || !preservedPreferences.alwaysTranslate) throw new Error("A catalog/target change lost exact-host site preferences.");

  await options.waitForTimeout(32_000);
  const offscreenContexts = await options.evaluate(async () => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }));
  if (offscreenContexts.length !== 0) throw new Error("The translation engine did not close after its idle timeout.");
  const idleWorkingSet = await profileWorkingSetBytes(profilePath);

  const peakMiB = memoryResult.memory.peakWasmHeapBytes / 1024 / 1024;
  const retainedMiB = memoryResult.memory.wasmHeapBytes / 1024 / 1024;
  process.stdout.write(`Smoke test passed in ${executablePath}\n`);
  process.stdout.write(`Browser: ${await fixture.evaluate(() => navigator.userAgent)}\n`);
  process.stdout.write(`Verified catalog repair, ${pivotPhases.join("/")} progress, the empty new-content control, unavailable-target setup, and saved site preferences.\n`);
  process.stdout.write("Verified local direct and sequential-pivot translation, consent gate, mixed languages, pseudo elements, nested shadow roots, same-origin frames, site-edit race, target-switch race, scoped dynamic scans, a >20,000-character node and exact restoration, queued and active cancellation, popup state, site preferences, and idle cleanup.\n");
  process.stdout.write(`Small dirty-root scan: ${JSON.stringify(smallScan)}.\n`);
  process.stdout.write(`Dynamic ${stressIntervals} × 100 append/edit stress: ${JSON.stringify({ before: stressBeforeMetrics, after: stressAfterMetrics, workingSetDifferenceMiB: +((stressAfterMemory - stressBeforeMemory) / 1024 / 1024).toFixed(1) })}.\n`);
  process.stdout.write(`Measured WASM heap: ${peakMiB.toFixed(1)} MiB peak, ${retainedMiB.toFixed(1)} MiB while the active model is resident (worker and model close after 30 seconds idle).\n`);
  if (baselineWorkingSet) {
    process.stdout.write(`Measured Helium working-set increase during first translation: ${((peakWorkingSet - baselineWorkingSet) / 1024 / 1024).toFixed(1)} MiB.\n`);
    process.stdout.write(`Working-set increase after engine idle cleanup: ${((idleWorkingSet - baselineWorkingSet) / 1024 / 1024).toFixed(1)} MiB.\n`);
  }
} finally {
  await context?.close();
  await close(pageServer);
  await close(crossServer);
  await rm(profilePath, { recursive: true, force: true });
}
