import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const nf = new Intl.NumberFormat("fr-FR");
const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });

/** Token counts: null means "not reported by the provider" and is shown as such, never as 0. */
export function fmtTokens(n: number | null | undefined, opts: { compact?: boolean } = {}) {
  if (n === null || n === undefined) return "inconnu";
  return opts.compact ? compact.format(n) : nf.format(n);
}

export function fmtUsd(n: number | null | undefined, digits = 4) {
  if (n === null || n === undefined) return "inconnu";
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(digits)}`;
  return `$${n.toFixed(2)}`;
}

export function fmtPct(ratio: number | null | undefined) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(ratio < 0.1 ? 1 : 0)} %`;
}

export function fmtMs(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
export function fmtRelative(ts: number | null | undefined) {
  if (!ts) return "—";
  const diff = (ts - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "à l'instant";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(ts).toLocaleDateString("fr-FR");
}

export function fmtDateTime(ts: number | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}

export const COST_KIND_LABEL: Record<string, string> = {
  api_billed: "Facturé API",
  subscription: "Inclus dans l'abonnement",
  local: "Local (gratuit)",
  unknown: "Coût inconnu",
};
