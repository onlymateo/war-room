/**
 * Logger that redacts anything that looks like a secret before writing.
 * Never log raw provider credentials: pass them through `redact` if in doubt.
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_\-]{8,}/g,
  /sk-(?:proj-|or-v1-)?[A-Za-z0-9_\-]{16,}/g,
  /xai-[A-Za-z0-9]{16,}/g,
  /AIza[0-9A-Za-z_\-]{20,}/g,
  /(Bearer\s+)[A-Za-z0-9._\-]{12,}/gi,
  /("?(?:api[_-]?key|authorization|token|secret)"?\s*[:=]\s*"?)[^",\s}]{6,}/gi,
];

export function redact(input: string): string {
  let out = input;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match, prefix?: string) =>
      typeof prefix === "string" && match.startsWith(prefix) ? `${prefix}[REDACTED]` : "[REDACTED]",
    );
  }
  return out;
}

function fmt(args: unknown[]): string {
  return redact(
    args
      .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : JSON.stringify(a)))
      .join(" "),
  );
}

export const log = {
  info: (...args: unknown[]) => console.log(`[warroom] ${fmt(args)}`),
  warn: (...args: unknown[]) => console.warn(`[warroom] ${fmt(args)}`),
  error: (...args: unknown[]) => console.error(`[warroom] ${fmt(args)}`),
};
