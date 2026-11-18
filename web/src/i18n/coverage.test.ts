import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { englishKeys } from "./index";

/** Every t("…") key used in the UI must have an English translation. */

const root = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "i18n" ? [] : sourceFiles(p);
    return /\.(tsx?|ts)$/.test(e.name) && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}

function usedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  const re = /\bt\(\s*"((?:[^"\\]|\\.)*)"/g;
  for (const file of sourceFiles(root)) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(re)) keys.set(JSON.parse(`"${m[1]}"`), path.relative(root, file));
  }
  return keys;
}

describe("i18n coverage", () => {
  it("has an English translation for every key used in the UI", () => {
    const en = new Set(englishKeys());
    const missing = [...usedKeys()].filter(([k]) => !en.has(k)).map(([k, f]) => `${f}: ${k}`);
    expect(missing).toEqual([]);
  });

  it("keeps placeholders consistent between French and English", async () => {
    const mod = await import("./index");
    const prev = mod.getLang();
    const bad: string[] = [];
    for (const k of englishKeys()) {
      const fr = [...k.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
      mod.setLang("en");
      const enText = mod.t(k);
      const enPh = [...enText.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
      if (fr !== enPh) bad.push(`${k} -> ${enText}`);
    }
    mod.setLang(prev);
    expect(bad).toEqual([]);
  });
});
