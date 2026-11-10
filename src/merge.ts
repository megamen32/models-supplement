/**
 * merge.ts — pure helpers to combine model entries.
 */

import { canonicalId } from "./canonical";
import type { ModelEntry } from "./build-types";

/** Copy into `a` every field `b` has and `a` lacks. Deep for `arena` (text/code). */
export function mergeEntries(a: ModelEntry, b: ModelEntry): ModelEntry {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (k === "canonical_id" || k === "benchmark_sources" || v === undefined) continue;
    if (out[k] === undefined || out[k] === null || out[k] === "") out[k] = v;
    else if (k === "arena" && typeof out[k] === "object" && typeof v === "object") {
      out[k] = { ...(v as object), ...(out[k] as object) };
    }
  }
  return out as unknown as ModelEntry;
}

/**
 * Re-key entries by canonicalId and merge those that land on the same id.
 * Ids that cannot be resolved (moving `~` aliases, unknown vendor) are dropped.
 * An entry already stored under its canonical id wins field conflicts.
 */
export function migrateEntries(models: Record<string, ModelEntry>): Record<string, ModelEntry> {
  const out: Record<string, ModelEntry> = {};
  const rows = Object.entries(models).map(([id, entry]) => {
    const slash = id.indexOf("/");
    const cid = canonicalId(id.slice(0, slash), id.slice(slash + 1));
    return { id, cid, entry };
  }).filter((r): r is { id: string; cid: string; entry: ModelEntry } => r.cid !== null);
  rows.sort((x, y) => Number(y.id === y.cid) - Number(x.id === x.cid) || x.id.localeCompare(y.id));
  for (const { cid, entry } of rows) {
    const base: ModelEntry = { ...entry, canonical_id: cid, vendor: cid.split("/")[0] };
    out[cid] = out[cid] ? mergeEntries(out[cid], base) : base;
  }
  for (const m of Object.values(out)) m.benchmark_sources = presentSources(m);
  return out;
}

const SOURCE_FIELDS = [
  "arena", "alpaca_lc", "routerai", "hle", "swebench_pro",
  "swe_bench_verified", "swe_bench_lite", "swe_bench_multilingual",
] as const;

/** Which source sub-records an entry actually holds. */
export function presentSources(m: ModelEntry): string[] {
  return SOURCE_FIELDS.filter((f) => (m as unknown as Record<string, unknown>)[f] !== undefined);
}
