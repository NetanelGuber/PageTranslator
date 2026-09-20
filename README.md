# Page Translator

Page Translator is an unpacked Manifest V3 extension for Chrome and Helium. It
detects foreign-language page text locally, asks before translating, and runs
Mozilla's Bergamot neural translation engine inside the browser. There is no
LibreTranslate server, account, or API key.

## Load the extension

1. Run `npm install` and `npm run build` if `dist/` is not already present.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this project's `dist` directory.
5. Choose a default target language in the settings page that opens.

Chrome/Helium 114 or newer is required because the extension uses a shared
offscreen document for its Web Worker.

## How it works

- TinyLD detects languages inside the content script. No page text leaves the
  browser during detection.
- The page banner asks for consent before translation starts.
- Bergamot JavaScript and WebAssembly are bundled in the extension. Only model
  data is downloaded from Mozilla's public model host.
- Models are cached by the browser and verified before reuse. A language direction
  is usually a 20–35 MB first-use download; cached models can be removed from
  extension settings.
- The available language list is rebuilt from the bundled model registry after
  an update. If a saved target loses its route, settings asks for a new target.
- Direct directions use one model. Other supported directions pivot through
  English, loading and unloading each leg sequentially.
- One offscreen worker is shared by all tabs and closes after 30 seconds idle.
- Page text is passed only to that local worker. It is never included in model
  download requests.

## Memory behavior

The automated Helium smoke test measured a 195.7 MiB WebAssembly heap and a
roughly 321–522 MiB first-translation working-set increase across repeated
Spanish-to-English runs on the test machine. The total includes the offscreen renderer,
download/decompression buffers, and the model. The worker closes after 30
seconds idle, releasing its WASM heap. Browser/OS figures vary by language,
page size, caching, and Chromium build. A practical active-translation budget
is therefore about 300–550 MB of additional RAM; idle use returns close to the
pre-translation baseline after the worker closes.

The worker deliberately uses one active model at a time, 4,000-character page
batches, transferred rather than cloned model buffers, a reduced Bergamot
workspace, and sequential pivoting to bound memory use.

## Page behavior

- Normal mode translates visible text and readable `title`, `alt`,
  `placeholder`, and `aria-label` attributes.
- Scripts, styles, templates, code/preformatted content, password fields,
  editable/user-entered text, and the extension's own UI are excluded.
- Aggressive mode additionally includes hidden and normally skipped
  presentational text, while retaining the hard safety exclusions.
- A debounced mutation observer translates new SPA/dynamic content.
- Dynamic mutations are serialized and coalesced while a translation is in
  progress, and the observer discards the extension's own DOM writes. This
  prevents reactive menus from repeatedly restarting model preparation.
- Visibility changes such as `class`, `style`, `hidden`, `aria-hidden`, and
  common dropdown state attributes trigger a debounced rescan, allowing menus
  that were already present but hidden to translate when opened.
- The active direct-language model is reused by follow-up dynamic batches and
  released with the worker after 30 seconds idle.
- **Show original** restores only values that still equal the extension's
  translation, so newer page-authored changes are preserved.
- **Translate new/changed content** checks pending page changes using the same
  scoped scan as automatic dynamic translation. It reports when none is pending.
- The popup reports detection, download, verification, model loading, pivot
  translation, completion, skipped content, cancellation, and failures.
- **Never for this site** is stored for the exact hostname.
- **Always translate this site** automatically translates confidently detected
  foreign text after every reload and is stored for the exact hostname.
- The popup's site-specific **Translate from** selector defaults to
  **Auto-detect**. Choosing a language completely bypasses TinyLD and page
  `lang` hints for that exact hostname; every eligible unit is treated as the
  chosen source language until **Auto-detect** is selected again.

## Development

```text
npm run typecheck
npm test
npm run build
npm run smoke
```

`npm run smoke` launches the locally installed Helium or Chrome executable,
loads `dist/`, and performs a real Mozilla-model translation. The first run
requires network access for model downloads.

See `VALIDATION.md` for the exact automated and manual validation boundary and
`THIRD_PARTY_NOTICES.md` for licensing/provenance.

## Current limitations

- Ordinary top-level HTTP/HTTPS pages only.
- No PDFs, browser-internal pages, cross-origin iframe contents, OCR, images,
  editable text, or mobile browsers.
- Model download requires access to Mozilla's Google Cloud Storage bucket.
- TinyLD and the available Bergamot model set do not cover every language.
# Developer diagnostics

Diagnostics are off by default. To inspect bounded per-unit outcomes while developing the extension, set `developerDiagnostics` to `true` in `chrome.storage.local` from the extension's service-worker console, then reload the page. Send `{ type: "GET_DIAGNOSTICS" }` to the page content script with `chrome.tabs.sendMessage(tabId, ...)` from that console. The response contains at most 300 entries with an outcome, unit kind, short selector, language codes, and an 80-character sample. Set the storage value to `false` to clear the buffer. No full page text or model payload is logged.

Open shadow roots and same-origin iframe documents are covered after page consent. Closed roots and cross-origin iframe contents are inaccessible. A same-origin iframe is owned by the top page's content script, since the manifest does not inject into subframes.

Translation result caching is limited to 3,000 entries and two million source/result characters. Restoration covers translated nodes connected to the page when **Show original** runs. Temporarily detached text or attribute nodes recover their restoration record if reinserted while translation is active. A node still detached when **Show original** runs is outside that guarantee; detached pseudo-element overrides are removed when their record is pruned.

Each on-device request contains at most 50 texts and 4,000 UTF-16 input characters in total. Longer source units are split at paragraph, sentence, whitespace, then grapheme boundaries and reassembled only after all their chunks succeed. The extension enforces the input bound; it does not impose a fixed output-character limit on Bergamot results. A corrupt cached model file is evicted and downloaded once more, and network bytes enter Cache Storage only after decompression, size, and hash checks succeed.
# PageTranslator
