import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { getLang, locale, t } from "@/i18n";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Token counts: null means "not reported by the provider" and is shown as such, never as 0. */
export function fmtTokens(n: number | null | undefined, opts: { compact?: boolean } = {}) {
  if (n === null || n === undefined) return t("inconnu");
  return opts.compact ? new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(n) : new Intl.NumberFormat(locale()).format(n);
}

export function fmtUsd(n: number | null | undefined, digits = 4) {
  if (n === null || n === undefined) return t("inconnu");
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(digits)}`;
  return `$${n.toFixed(2)}`;
}

export function fmtPct(ratio: number | null | undefined) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  const v = (ratio * 100).toFixed(ratio < 0.1 ? 1 : 0);
  return getLang() === "en" ? `${v}%` : `${v} %`;
}

export function fmtMs(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function fmtRelative(ts: number | null | undefined) {
  if (!ts) return "—";
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: "auto" });
  const diff = (ts - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return t("à l'instant");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(ts).toLocaleDateString(locale());
}

export function fmtDateTime(ts: number | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" });
}

export function fmtBytes(n: number) {
  const en = getLang() === "en";
  if (n < 1024) return `${n} ${en ? "B" : "o"}`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} ${en ? "KB" : "Ko"}`;
  return `${(n / 1024 / 1024).toFixed(1)} ${en ? "MB" : "Mo"}`;
}

/** Labels are French source strings: render them through t(). */
export const COST_KIND_LABEL: Record<string, string> = {
  api_billed: "Facturé API",
  subscription: "Inclus dans l'abonnement",
  local: "Local (gratuit)",
  unknown: "Coût inconnu",
};
