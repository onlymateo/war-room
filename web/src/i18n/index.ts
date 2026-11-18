/**
 * Minimal i18n. French is the source language: the French text itself is the
 * key, so `t("Nouveau chat")` returns the French string in French mode and the
 * English translation (from web/src/i18n/en/*.ts) in English mode.
 *
 * - Variables: t("Supprimer « {name} » ?", { name }) — placeholders are {name}.
 * - Missing translations fall back to the French text (and are logged once in dev).
 * - `t` is a plain function usable anywhere (components, helpers, toasts). The app
 *   root is re-mounted when the language changes, so everything re-renders.
 */

export type Lang = "fr" | "en";

type Dict = Record<string, string>;

const modules = import.meta.glob<{ en: Dict }>("./en/*.ts", { eager: true });
const EN: Dict = Object.assign({}, ...Object.values(modules).map((m) => m.en));

const STORAGE_KEY = "wr-lang";

function initialLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "en" || v === "fr") return v;
  } catch {
    /* ignore */
  }
  return "fr";
}

let current: Lang = initialLang();
const listeners = new Set<(l: Lang) => void>();
const missing = new Set<string>();

export function getLang(): Lang {
  return current;
}

/** BCP 47 locale for Intl formatting. */
export function locale(): string {
  return current === "en" ? "en-US" : "fr-FR";
}

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  listeners.forEach((fn) => fn(lang));
}

export function onLangChange(fn: (l: Lang) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function interpolate(s: string, vars?: Record<string, string | number | null | undefined>) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

/**
 * A key may carry a disambiguation context after "##" when the same French word
 * needs different English translations: t("Synthèse##project"). The context is
 * never displayed in French.
 */
export function t(key: string, vars?: Record<string, string | number | null | undefined>): string {
  const ctx = key.indexOf("##");
  const fr = ctx >= 0 ? key.slice(0, ctx) : key;
  if (current === "fr") return interpolate(fr, vars);
  return translate(key, fr, vars);
}

function translate(key: string, fr: string, vars?: Record<string, string | number | null | undefined>): string {
  const en = EN[key];
  if (en === undefined) {
    if (import.meta.env?.DEV && !missing.has(key)) {
      missing.add(key);
      console.warn(`[i18n] missing English for: ${key}`);
    }
    return interpolate(fr, vars);
  }
  return interpolate(en, vars);
}

/** For tests and tooling: every French key that has an English translation. */
export function englishKeys(): string[] {
  return Object.keys(EN);
}
