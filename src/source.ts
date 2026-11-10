/**
 * source.ts — the contract every data source follows, plus the thin HTTP helper.
 *
 * A source returns `{ok, records, error?}`. Records are "contributions": one
 * value for one field of one canonical model id. A failed source returns no
 * records; the build then carries its fields over from the previous file.
 */

import { sha256, type FetchStat } from "./provenance";

export interface Contribution {
  id: string;
  /** Field path on the entry: "hle", "arena.text", … (one dot at most). */
  field: string;
  value: unknown;
  display_name?: string;
  /** Only attach to a model some other source already knows; never create one. */
  attach_only?: boolean;
}

export interface UnmatchedItem {
  field: string;
  display_name: string;
  reason: string;
  kind?: "scaffold" | "model";
}

export interface SourceResult {
  ok: boolean;
  records: Contribution[];
  error?: string;
  unmatched?: UnmatchedItem[];
  stat?: FetchStat;
  meta?: Record<string, unknown>;
}

export const failedResult = (error: string, stat?: FetchStat): SourceResult =>
  ({ ok: false, records: [], error, stat });

/** Thin fetch: never throws. */
export async function fetchText(
  name: string, url: string, opts: { headers?: HeadersInit; timeoutMs?: number } = {},
): Promise<{ text?: string; stat: FetchStat }> {
  const t0 = performance.now();
  const stat = (o: Partial<FetchStat> = {}): FetchStat => ({
    name, url, fetched_at: new Date().toISOString(),
    duration_ms: Math.round(performance.now() - t0), bytes: 0, sha256: "", ok: false, ...o,
  });
  try {
    const res = await fetch(url, { headers: opts.headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
    if (!res.ok) return { stat: stat({ error: `HTTP ${res.status}` }) };
    const text = await res.text();
    return { text, stat: stat({ bytes: text.length, sha256: sha256(text), ok: true }) };
  } catch (e) {
    return { stat: stat({ error: String(e) }) };
  }
}

/** Run fetch + parse; attach the stat; mark parse failures on the stat too. */
export async function runSource(
  name: string, url: string, parse: (text: string) => SourceResult,
  opts: { headers?: HeadersInit; timeoutMs?: number } = {},
): Promise<SourceResult> {
  const { text, stat } = await fetchText(name, url, opts);
  if (text === undefined) return failedResult(stat.error ?? "fetch failed", stat);
  const r = parse(text);
  return { ...r, stat: r.ok ? stat : { ...stat, ok: false, error: r.error } };
}
