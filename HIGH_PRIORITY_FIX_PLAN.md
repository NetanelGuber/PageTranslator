# High-priority fix plan

Scope: fix the four issues identified in the 0.5.0 review. Keep the existing on-device detection, explicit consent, exact-host preferences, restoration rules, and Chrome/Helium Manifest V3 architecture. This plan does not cover back/forward cache handling, repository tracking, or broader live-site validation.

## 1. Recover from worker failure

**Problem:** `getWorker()` can retain a failed or terminated `EngineWorker`. Later calls may reuse it and wait indefinitely.

**Changes**

- Give `EngineWorker` an explicit live/terminated state. Reject new calls after termination, and reject outstanding calls if `postMessage` throws, initialization fails, or the worker reports an error.
- Clear `workerClient` and `loadedPair` when the current worker fails. Ensure a later request creates and awaits a fresh worker. Avoid clearing a newer worker from an older failure callback.
- Bound each unanswered worker call with a timeout appropriate to initialization, model loading, and translation. On timeout, terminate and discard that worker. Preserve the existing single retry policy for known model/parser/WASM errors; do not create an unbounded retry loop.

**Gate:** Simulate initialization rejection, worker error, and an unanswered call. Each request must settle with an error or cancellation; a subsequent request must start with a new worker and succeed. Then run the existing real-model Helium smoke test.

## 2. Allow cancellation while busy

**Problem:** the popup disables **Show original** during downloads and translation, leaving no accessible cancellation action.

**Changes**

- Add a clear **Cancel translation** action that is enabled for the active busy phases. Route it through the existing `RESTORE_PAGE` cancellation and restoration path.
- Make cancellation visible immediately in popup/page state. Invalidate the current run before awaiting engine cancellation so late progress or results cannot replace restored text.
- Keep **Show original** for completed translations. Handle cancellation when some batches have completed and when none have completed.

**Gate:** In a real browser, cancel during model download and during active translation. The popup must return promptly, translated values must restore where present, late results must not reappear, and a new translation must still work. Add focused state/UI coverage for button availability.

## 3. Reassess pages that render text late

**Problem:** detection runs once on startup, while mutation observers start only after translation begins. Late-rendered text can be missed entirely.

**Changes**

- Start lightweight DOM observation before the initial detection scan. While no translation is active, coalesce relevant text/visibility mutations and reassess the changed content without downloading a model or translating before consent.
- Reuse the existing dirty-root and self-write filtering where possible. Bound the debounce so rapidly rendered pages do not trigger repeated full scans or repeated banners.
- Preserve **Not now** for the current page, and honor **Never for this site**. Once the user translates, hand observation to the existing dynamic-translation path without duplicate observers.

**Gate:** A page that initially has no eligible text and inserts a foreign paragraph later must show one prompt. A page that changes hidden text to visible must also be detected. No model request may start before consent; **Not now** and **Never** must suppress unwanted prompts. Verify in Helium as well as focused unit tests.

## 4. Honor explicit Always preference on short pages

**Problem:** `shouldPrompt()` applies the 80-character/three-unit threshold before `isAlwaysTranslate()` is checked. A short page with an explicit source language remains untranslated despite the saved Always choice.

**Changes**

- Separate "should offer a new consent prompt" from "should act on existing consent." When both exact-host **Always translate** and an explicit source language are saved, translate any eligible foreign unit with a valid model route, regardless of the prompt threshold.
- Keep conservative detection and prompt thresholds for sites without that explicit preference. Keep same-language and missing-route checks in place.

**Gate:** Reload a short, one-unit page with Always plus an explicit source and verify automatic translation. Verify that the same page without Always does not auto-translate, that **Never** wins, and that a missing route does not start a model download.

## Final validation

After each gate, run typecheck, focused tests, build, and the relevant Helium fixture. At the end run the full unit suite and `npm run smoke`; record commands, browser observations, and any unverified Chrome behavior in `VALIDATION.md`. Stop optional testing once these four behaviors are demonstrated.
