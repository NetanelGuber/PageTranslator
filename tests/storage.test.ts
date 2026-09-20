import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLanguageCatalog, getLanguageCatalogVersion, getSitePreferences, getSourceLanguage, isAlwaysTranslate, isNeverTranslate, saveLanguageCatalog, setAlwaysTranslate, setNeverTranslate, setSourceLanguage } from "../src/shared/storage";

const values: Record<string, unknown> = {};

beforeEach(() => {
  for (const key of Object.keys(values)) delete values[key];
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: values[key] })),
        set: vi.fn(async (entries: Record<string, unknown>) => { Object.assign(values, entries); })
      }
    }
  });
});

describe("site preferences", () => {
  it("stores exact hostnames and removes disabled preferences", async () => {
    await setNeverTranslate("example.test", true);
    expect(await isNeverTranslate("example.test")).toBe(true);
    expect(await isNeverTranslate("sub.example.test")).toBe(false);
    await setNeverTranslate("example.test", false);
    expect(await getSitePreferences()).toEqual({});
  });

  it("stores always-translate per hostname and keeps it mutually exclusive with never", async () => {
    await setAlwaysTranslate("example.test", true);
    expect(await isAlwaysTranslate("example.test")).toBe(true);
    expect(await isAlwaysTranslate("sub.example.test")).toBe(false);
    expect(await isNeverTranslate("example.test")).toBe(false);

    await setNeverTranslate("example.test", true);
    expect(await isAlwaysTranslate("example.test")).toBe(false);
    expect(await isNeverTranslate("example.test")).toBe(true);

    await setNeverTranslate("example.test", false);
    expect(await getSitePreferences()).toEqual({});
  });

  it("retains an explicit source language until auto-detect is selected again", async () => {
    await setSourceLanguage("example.test", "es");
    await setAlwaysTranslate("example.test", true);
    expect(await getSourceLanguage("example.test")).toBe("es");

    await setAlwaysTranslate("example.test", false);
    expect(await getSourceLanguage("example.test")).toBe("es");
    await setSourceLanguage("example.test", null);
    expect(await getSourceLanguage("example.test")).toBeNull();
    expect(await getSitePreferences()).toEqual({});
  });
});

describe("versioned bundled catalog", () => {
  it("replaces catalog and version while preserving target and site preferences", async () => {
    values.translatorSettings = { targetLanguage: "fr" };
    values.sitePreferences = { "example.test": { sourceLanguage: "es" } };
    await saveLanguageCatalog([{ code: "en", name: "English", targets: ["fr"] }], "2026-09-19");
    expect(await getLanguageCatalogVersion()).toBe("2026-09-19");
    expect((await getLanguageCatalog())[0]?.code).toBe("en");
    expect(values.translatorSettings).toEqual({ targetLanguage: "fr" });
    expect(await getSourceLanguage("example.test")).toBe("es");
  });
});
