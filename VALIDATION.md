# Validation record

## 2026-09-19 improvement plan: baseline and Milestone 1

- Baseline before edits: `npm run typecheck`, `npm test` (18 tests), and `npm run build` passed. `npm run smoke` passed in Helium/Chromium 153.0.0.0 on Windows. The baseline fixture verified consent, Spanish to English, Spanish to French pivot, dynamic additions, site preferences, restoration, and engine idle cleanup. Peak WASM heap: 195.7 MiB; first translation working-set increase: 368.9 MiB; post-idle difference: +12.2 MiB.
- Milestone 1 after edits: `npm run typecheck`, `npm test` (24 tests), `npm run build`, and `npm run smoke` passed. Unit cases cover unsupported detector script, supported language absent from the model catalog, own text versus conflicting `lang` and block text, short and technical labels, mixed-script abstention, Japanese label with English sibling, and explicit site override.
- Browser evidence: Helium/Chromium 153.0.0.0, local HTTP smoke fixture, Spanish to English and Spanish to French. The Spanish sibling translated while the short Latin `Arabic:` label stayed unchanged. The existing English paragraph stayed unchanged, and dynamic rows translated. The script also confirmed no model request before consent and exact restoration. Peak WASM heap: 195.7 MiB; first translation working-set increase: 340.9 MiB; post-idle difference: -11.6 MiB. Working-set readings include browser-process variance.
- Policy: mixed-script text in a single text node is left uncertain; it is not split. Very short labels without reliable metadata abstain. TinyLD ranking scores are used as thresholds and are not shown as probabilities. Unsupported detected codes remain intact until route lookup.

## Milestone 2: visible text and diagnostics (2026-09-19)

- Gate: `npm run typecheck`, `npm test` (29 tests), `npm run build`, and `npm run smoke` passed after the Milestone 2 changes.
- Unit coverage: CSS literal parsing (Unicode and escapes), rejection of complex/decorative/private-use content, nested open shadow-root collection without duplicate owners, accessible iframe collection, a denied `contentDocument`, and a 300-entry bounded diagnostic buffer with 80-character samples.
- Browser: Helium/Chromium 153.0.0.0 on Windows, local HTTP fixture. Spanish `::before` and `::after`, Russian `::before` (Russian to English), and RTL Arabic `::before` (Arabic to English) visibly changed and restored. Japanese `::after` stayed original because `ja → en` has no `Release` route in the bundled catalog; opt-in diagnostics reported `route-missing`, while Russian pseudo text reported `translated`. A class change refreshed generated text; a later class removed it. The site's CSS text was unchanged. Open and nested shadow text translated/restored. A same-origin iframe translated after initial load and navigation and restored; a different-port frame had inaccessible contents and was untouched. The icon glyph was skipped. Consent and idle cleanup still passed. Peak WASM heap: 195.7 MiB; measured first-translation working-set increase: 436.3 MiB; post-idle difference: -31.0 MiB, within browser-process variance.
- Render cost fixture: `node scripts/benchmark-dom.mjs` in headless Helium 153.0.0.0. At 100 / 5,000 / 50,000 text nodes, text-node walks took 0.2 / 0.3 / 2.4 ms; inspecting `::before` and `::after` computed content for 101 / 5,001 / 50,001 elements took 0.3 / 8.3 / 82.2 ms. Only one element had pseudo text. This establishes the cost of broad initial pseudo inspection; incremental subtree scoping is the next gate.
- Developer switch: `developerDiagnostics` in `chrome.storage.local`, documented in README. Entries are off by default and capped at 300. No full page text or model payload is retained. Chrome was unavailable for an independent browser run.

## Milestone 3: safe dynamic updates (2026-09-19)

- Gate: `npm run typecheck`, `npm test` (31 tests), `npm run build`, and `npm run smoke` passed. `SelfWriteTracker` unit tests cover an isolated extension attribute write and a site text write occurring before the observer callback.
- Browser: Helium/Chromium 153.0.0.0 local fixture. A site replaced a Spanish node during the first translation; the late result did not overwrite the newer site text. Six rapidly inserted menu rows translated. A generated-content class change and later removal were processed without reappearing on restore. On a page with 5,000 existing short labels, translating a new Spanish paragraph used a dirty scan of at most 100 inspected nodes (asserted from `GET_DIAGNOSTICS.lastScan`) rather than a whole-page scan. The script also changed the target from English to French while a page translation was running; the final text matched a direct Spanish-to-French pivot result and stayed French after another 700 ms. Progress was associated with the active request ID. Idle cleanup still passed. Peak WASM heap: 196.1 MiB; first-translation working-set increase: 539.6 MiB; post-idle difference: -33.0 MiB.
- A real multi-language stress run exposed an intermittent Bergamot `memory access out of bounds` error on a model switch. A single fresh-worker retry for that specific error, during model load or translation, let the browser gate pass. The broader model integrity and retry policy remains in Milestone 5.

## Milestone 4: memory and scan cost (2026-09-19)

- Gate: `npm run typecheck`, `npm test` (35 tests), `npm run build`, and `npm run smoke` passed. The extended `STRESS_INTERVALS=100` Helium smoke run passed after the same build.
- Unit coverage: LRU eviction and recency, a character budget, fresh visibility results after an ancestor's `aria-hidden` changes (including a shadow host), and page-language sampling that ignores repeated navigation text and stops at 8,000 characters.
- Browser: Helium/Chromium 153.0.0.0. Detaching and reinserting a translated text node before **Show original** preserved its restoration record; the later restore returned its source. Detaching a pseudo owner removed its override attribute and rule, and reinsertion translated it again. The browser run also exposed and verified a fix for replaced text nodes: the owner text node, not only its still-connected parent element, must determine whether a strong record can be pruned.
- Repeatable DOM cost fixture (`node scripts/benchmark-dom.mjs`): 100 / 5,000 / 50,000 text nodes. Visibility checks without a per-scan cache took 0.2 / 5.3 / 46.3 ms; with the cache, 0.1 / 2.4 / 25.9 ms. Pseudo computed-style reads took 0.2 / 8.7 / 95.3 ms. These are headless Helium 153 measurements, not whole extension scan times.
- Dynamic fixture, 10 intervals of 100 appended and edited nodes: translation requests stayed at 7, cache hits rose from 0 to 19, cache entries stayed at 22, connected records rose from 17 to 1,017, and the profile working set rose 21.0 MiB with the added DOM. The small single-root update inspected 2 nodes.
- Longer fixture, 100 intervals of 100 appended and edited nodes: translation requests stayed at 7, cache hits rose to 199, cache entries stayed at 22, connected records rose to 10,017 for 10,000 connected additions, and working set rose 122.1 MiB. After reload and engine idle cleanup, the profile was 81.8 MiB above its pre-translation baseline. This includes retained browser heap and process variance; it does not establish leak-free behavior on unrelated sites. LRU limits are 3,000 entries and two million key/result characters. The connected-node restoration policy is documented in README.

## Milestone 5: translation pipeline hardening (2026-09-19)

- Gate: `npm run typecheck`, `npm test` (52 tests), `npm run build`, and `npm run smoke` passed after the pipeline changes.
- Unit coverage: exact 4,000/4,001 boundaries, a 20,000-character string, punctuation, no punctuation, emoji, combining marks, CJK, RTL, ordered chunk reconstruction, and a single impossible oversized grapheme. Count mismatches are rejected before indexed application and at each offscreen pivot leg. Cached corrupt bytes are evicted and replaced once; fresh corrupt size/hash bytes never enter Cache Storage. Fetch and body-read cancellation leave no cache entry. An unchanged-success marker requires exact source value and language direction and clears on explicit retranslation.
- Browser: Helium/Chromium 153.0.0.0, local fixture. A source node over 20,000 characters translated through bounded requests and restored byte-for-byte to its original text. A queued request was cancelled while an earlier request completed; an active request was cancelled; a subsequent request still succeeded. Existing Spanish-to-French pivot, target-switch race, and idle cleanup passed. Peak WASM heap: 196.1 MiB; first-translation working-set increase: 571.2 MiB; post-idle difference: +28.8 MiB. The 10 × 100 dynamic fixture had 19 cache hits and no additional translation requests before the long-node check.
- Model-load/parser failures and the observed WASM out-of-bounds failure each receive at most one fresh-worker retry. Parser retry evicts the affected pair's cached files. The extension bounds UTF-16 input request characters; Bergamot output length is not capped by the extension. Gzip decompression and real model integrity passed in the Helium smoke test, while deterministic corruption cases used uncompressed in-memory test responses.

## Milestone 6: catalog and user controls (2026-09-20)

- Final 0.5.0 gate: `npm run typecheck`, `npm test` (53 tests across 14 files), `npm run build`, and `npm run smoke` all passed. The built `dist/manifest.json` and both package version fields are 0.5.0.
- Unit coverage: versioned catalog storage preserves the supplied `registry.generated` value. The earlier 52 unit tests remain passing.
- Browser: Helium/Chromium 153.0.0.0 on Windows, local HTTP fixture, real Spanish-to-English and Spanish-to-French Bergamot directions. The fixture replaced a saved catalog with a stale version and bogus language; `GET_ENGINE_INFO` restored the bundled list and generated version while retaining the saved English target. A later unavailable `zz` target produced a setup message explaining the missing route; the exact-host Spanish source and Always preference remained saved. The popup's **Translate new/changed content** action explicitly reported that no changed content was pending after automatic scans. The normal Translate page and Show original controls still translated and restored the fixture.
- Browser progress messages observed during the real model run: `loading`, `downloading`, `verifying`, `translating`, and `pivoting`. Skipped unsupported Japanese pseudo text remained unchanged and was reported as `route-missing` in opt-in diagnostics, separate from an engine failure. Queued and active request cancellation returned `CANCELLED`; translation succeeded afterward. The page state also exposes `complete`, `partial`, `cancelled`, and `failed` for their corresponding outcomes. These terminal state names were not each sampled in isolation by the browser script.
- The same run rechecked mixed-language labels, pseudo elements, nested open shadow roots, same-origin frame navigation, cross-origin denial, mutation races, a 20,000-character node, exact restoration, and 30-second engine idle cleanup. A small dirty-root change inspected 2 nodes and read 2 pseudo styles. On 10 × 100 appended/edited nodes, translation requests remained 7, cache hits rose 0 → 19, connected records rose 17 → 1,017, and working set rose 22.8 MiB. Peak active WASM heap was 196.1 MiB; first-translation profile working-set change was +414.8 MiB and post-idle change was -13.6 MiB. These are profile-wide measurements and vary with browser process scheduling.
- Diagnostics remain an off-by-default documented `developerDiagnostics` storage switch, with a 300-entry cap and 80-character text samples. Chrome was not installed, so the browser gate used Helium only. Representative live article, Reddit, and YouTube pages were not part of the repeatable browser fixture; the local fixture and prior 100 / 5,000 / 50,000-node benchmarks provide the stated evidence. The 100 × 100 long-session stress result in Milestone 4 predates the Milestone 6 catalog and UI changes; no claim is made about a new long-session run on 0.5.0.

## Automated checks

Run on 2026-09-18:

- `npm run typecheck`: passed.
- `npm test`: passed after the on-device migration, including language
  normalization, detection thresholds, DOM safety filtering, batching,
  restoration, storage preferences, and model-route selection.
- `npm run build`: passed and produced the unpackable `dist/` directory with
  the Manifest V3 service worker, content script, UI pages, offscreen engine,
  bundled Bergamot JS/WASM, license, and model registry.
- `npm audit`: 0 known vulnerabilities.
- `npm run smoke`: passed in installed Helium using real Mozilla models.

The Helium smoke test verifies:

- No model request begins before the page's **Translate** consent action.
- Spanish text translates locally to English while English text is unchanged.
- Newly inserted Spanish text is translated.
- Rapidly inserted dropdown-style rows are coalesced while the initial model
  translation is running, without restarting the active translation loop.
- A Spanish-to-French route translates sequentially through English.
- Popup state reaches the page and **Show original** restores the source text.
- An exact-hostname **Always translate this site** preference translates the
  current page and automatically translates it again after a full reload.
- An explicit exact-hostname source-language preference bypasses detection,
  remains active after reload, and classifies all eligible units only as the
  selected source language.
- The offscreen translation context closes after 30 seconds idle.

Measured on that run with the current Bergamot v0.6.0 engine:

- WebAssembly linear heap peak: 195.7 MiB.
- Total Helium profile working-set increase during first Spanish-to-English
  translation: approximately 321–522 MiB across repeated and dynamic stress runs.
- After the 30-second engine cleanup, the measured profile returned to within
  approximately 15 MiB of its pre-translation baseline (and slightly below it
  on one run due to ordinary browser-process variance).

The working-set measurement is a machine/browser-level observation rather than
a deterministic unit-test assertion. It includes Chromium process overhead and
temporary model download/decompression buffers.

## High-priority fixes (2026-09-22)

### Gate 1: worker recovery

- `npm run typecheck`: passed. `npm test -- --run tests/engine-worker.test.ts`: 3 tests passed. `npm run build`: passed.
- Focused tests simulated initialization rejection, worker error, and an unanswered translation call. Each rejected and terminated the worker; a fresh instance initialized afterward.
- `npm run smoke`: passed in Helium/Chromium 153.0.0.0 with real bundled models, including direct and pivot translation, cancellation, and engine idle cleanup. This browser run did not inject a worker failure; those failure paths were covered with the focused tests.

### Gate 2: cancel while busy

- `npm run typecheck`: passed. `npm test -- --run tests/page-actions.test.ts tests/engine-worker.test.ts`: 9 tests passed. `npm run build`: passed.
- `npm run smoke`: passed in Helium/Chromium 153.0.0.0. The popup exposed an enabled Cancel action during model download and active translation; clicking it restored original text promptly, no late result reappeared after 700 ms, and a new page translation completed after each cancellation. The same run exercised queued and active engine cancellation.

### Gate 3: late page text

- `npm run typecheck`: passed. `npm test -- --run tests/dom.test.ts tests/coalescing-runner.test.ts`: 8 tests passed. `npm run build`: passed.
- `npm run smoke`: passed in Helium/Chromium 153.0.0.0. A page initially without foreign text showed one prompt after a Spanish paragraph was inserted. Revealing hidden Spanish text also prompted. Not now suppressed later prompts on that page; Never for this site suppressed them on a new page. No offscreen engine existed before consent. The existing dynamic translation and model smoke checks still passed.

### Gate 4: explicit Always consent on short pages

- `npm run typecheck`: passed. `npm test -- --run tests/detection.test.ts`: 11 tests passed. `npm run build`: passed.
- `npm run smoke`: passed in Helium/Chromium 153.0.0.0. Reloading a one-unit short Spanish page with exact-host Always and explicit Spanish source translated it automatically without a prompt. Without Always it remained original. Never overrode Always; a Japanese source without a model route and an English source equal to the target left it original. The missing-route case did not create an offscreen engine.

### Final pass

- `npm test`: 65 tests passed across 16 files, including a synchronous worker `postMessage` failure. `npm run build` passed typecheck and both Vite bundles. `npm run smoke` passed again in Helium/Chromium 153.0.0.0 after the final worker cleanup change.
- Google Chrome behavior remains unverified on this machine. The worker failure injections are unit-level checks; real-model browser translation and cancellation passed in Helium.
- Release metadata was bumped to 0.5.1 after the fix validation: `package.json`, both package-lock version fields, and `public/manifest.json`. The 0.5.1 package and manifest were rebuilt and checked for matching versions; the Helium smoke run above exercised the same code before this metadata-only bump.

## Not yet manually proven

- Current Google Chrome behavior (Chrome was not installed on the development
  machine).
- Human visual inspection of the final 0.5.1 build in Helium; automated real-browser fixtures passed for the same code before the metadata-only version bump.
- Long-session behavior across many unrelated sites and language pairs.
- Every language model exposed by Mozilla's release registry.
- Store packaging/review; this remains an unpacked local MVP.
