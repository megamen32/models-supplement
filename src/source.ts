/**
 * source.ts — pure helpers for honest source handling.
 *
 * Every source returns a SourceResult. A failed source adds nothing new: its
 * fields are carried over from the previous supplement.json and its status is
 * "stale" (nothing to carry: "absent"). Nothing is ever fabricated.
 */

import type { ModelEntry } from "./build-types";
import type { FetchStat } from "./provenance";

export interface SourceResult<T> {
  ok: boolean;
  records: T;
  error?: string;
  stats: FetchStat[];
}

export type SourceStatus = "ok" | "stale" | "absent";

export interface SourceState {
  url: string;
  status: SourceStatus;
  error?: string;
  last_ok_at?: string;
  carried?: number;
}

/** Entry fields owned by each source. */
export const SOURCE_FIELDS: Record<string, string[]> = {
  arena: ["arena"],
  alpaca_lc: ["alpaca_lc"],
  routerai: ["routerai"],
  hle: ["hle", "swebench_pro"],
  swe_bench_leaderboard: ["swe_bench_verified", "swe_bench_lite", "swe_bench_multilingual"],
  aider_polyglot: ["aider_polyglot"],
  livebench: ["livebench"],
  terminal_bench: ["terminal_bench"],
};

/** Fetch-stat names (provenance.sources) each source is recorded under. */
export const SOURCE_STAT_NAMES: Record<string, string[]> = {
  arena: ["arena:text", "arena:code"],
  alpaca_lc: ["alpaca_lc"],
  routerai: ["routerai:models"],
  hle: ["cais_dashboard"],
  swe_bench_leaderboard: ["swe_bench_leaderboard"],
  aider_polyglot: ["aider_polyglot"],
  livebench: ["livebench:table", "livebench:categories"],
  terminal_bench: ["terminal_bench:leaderboard"],
};

export interface PreviousSupplement {
  generated_at?: string;
  currency?: { usd_rub: number; source: string; fetched_at: string } | null;
  models: Record<string, ModelEntry>;
  sources?: Record<string, unknown>;
  provenance?: { sources?: FetchStat[] };
  unmatched_display_names?: Record<string, unknown[]>;
}

/** Parse a previous supplement.json; null when unusable. */
export function parsePrevious(text: string): PreviousSupplement | null {
  try {
    const v = JSON.parse(text) as PreviousSupplement;
    if (!v || typeof v !== "object" || !v.models || typeof v.models !== "object" || Array.isArray(v.models)) return null;
    return v;
  } catch {
    return null;
  }
}

/** When this source last delivered live data, according to the previous file. */
export function lastOkAt(prev: PreviousSupplement | null, name: string): string | undefined {
  if (!prev) return undefined;
  const own = prev.sources?.[name];
  if (own && typeof own === "object" && "last_ok_at" in own) {
    const v = (own as { last_ok_at?: unknown }).last_ok_at;
    if (typeof v === "string") return v;
  }
  const names = SOURCE_STAT_NAMES[name] ?? [];
  const oks = (prev.provenance?.sources ?? []).filter((s) => names.includes(s.name) && s.ok);
  return oks.length > 0 && oks.length === names.length ? oks.map((s) => s.fetched_at).sort()[0] : undefined;
}

/**
 * Copy `fields` of every previous entry into `fresh`, only where `fresh` has no
 * value yet. Returns the number of values carried.
 */
export function carryFields(
  fresh: Record<string, ModelEntry>,
  prevModels: Record<string, ModelEntry>,
  fields: string[],
): number {
  let n = 0;
  for (const [id, old] of Object.entries(prevModels)) {
    for (const f of fields) {
      const v = (old as unknown as Record<string, unknown>)[f];
      if (v === undefined || v === null) continue;
      if (f === "arena" && !((v as { elo?: number }).elo! > 0)) continue; // fabricated by an older build
      const target = (fresh[id] ??= {
        canonical_id: id,
        vendor: id.split("/")[0],
        ...(old.display_name ? { display_name: old.display_name } : {}),
        benchmark_sources: [],
      });
      const t = target as unknown as Record<string, unknown>;
      if (t[f] === undefined) { t[f] = v; n++; }
    }
  }
  return n;
}

/** Status record for one source after the build. Pure. */
export function sourceState(args: {
  url: string;
  ok: boolean;
  error?: string;
  carried: number;
  prev: PreviousSupplement | null;
  name: string;
  now: string;
}): SourceState {
  if (args.ok) return { url: args.url, status: "ok", last_ok_at: args.now };
  const last = lastOkAt(args.prev, args.name);
  return {
    url: args.url,
    status: args.carried > 0 ? "stale" : "absent",
    ...(args.error ? { error: args.error } : {}),
    ...(last ? { last_ok_at: last } : {}),
    ...(args.carried > 0 ? { carried: args.carried } : {}),
  };
}

/** First error message among fetch stats that failed. */
export function firstError(stats: FetchStat[]): string | undefined {
  const bad = stats.filter((s) => !s.ok);
  return bad.length > 0 ? bad.map((s) => `${s.name}: ${s.error ?? "failed"}`).join("; ") : undefined;
}
