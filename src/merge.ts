/**
 * merge.ts — pure helpers that turn a pile of per-source entries into one
 * entry per model.
 */

import { canonicalId, idKey } from "./canonical";
import type { ModelEntry } from "./build-types";

const SOURCE_FIELDS = [
  "arena", "alpaca_lc", "routerai", "hle", "swebench_pro",
  "swe_bench_verified", "swe_bench_lite", "swe_bench_multilingual",
] as const;

/** Which source sub-records an entry actually holds. */
export function presentSources(m: ModelEntry): string[] {
  return SOURCE_FIELDS.filter((f) => (m as unknown as Record<string, unknown>)[f] !== undefined);
}

/** Copy into `a` every field `b` has and `a` lacks. */
export function mergeEntries(a: ModelEntry, b: ModelEntry): ModelEntry {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (k === "canonical_id" || k === "benchmark_sources" || v === undefined) continue;
    if (out[k] === undefined || out[k] === null || out[k] === "") out[k] = v;
  }
  return out as unknown as ModelEntry;
}

function isMovingAlias(id: string): boolean {
  return id.startsWith("~") || id.includes("/~");
}

/** An arena record exists only with a real arena score (elo > 0). */
function dropFakeArena(m: ModelEntry): ModelEntry {
  if (m.arena && !(m.arena.elo > 0)) {
    const { arena: _arena, ...rest } = m;
    return rest as ModelEntry;
  }
  return m;
}

/** An entry that holds nothing but an AlpacaEval row matches no known model. */
function isOrphan(m: ModelEntry): boolean {
  return presentSources({ ...m, alpaca_lc: undefined }).length === 0 && !m.models_dev;
}

/**
 * Re-key entries so that every model has exactly one id, and merge twins.
 *
 *  - models.dev ids are the reference spelling and are kept verbatim; the id
 *    of an entry that has `models_dev` is never rewritten.
 *  - any other id goes through canonicalId (dotted versions, one vendor alias).
 *  - ids that share an `idKey` (differ only by "."/"-" or vendor alias) merge;
 *    the models.dev spelling wins, else the dotted one.
 *  - moving `~` aliases and unresolvable ids are dropped, as are fabricated
 *    arena records and AlpacaEval-only entries.
 */
export function reconcileModels(models: Record<string, ModelEntry>): Record<string, ModelEntry> {
  type Row = { id: string; ref: boolean; entry: ModelEntry };
  const groups = new Map<string, Row[]>();
  for (const [id, entry] of Object.entries(models)) {
    if (isMovingAlias(id)) continue;
    const ref = entry.models_dev !== undefined;
    let cid: string | null = id;
    if (!ref) {
      const slash = id.indexOf("/");
      cid = slash < 0 ? canonicalId(null, id) : canonicalId(id.slice(0, slash), id.slice(slash + 1));
    }
    if (!cid) continue;
    const key = idKey(cid);
    groups.set(key, [...(groups.get(key) ?? []), { id: cid, ref, entry }]);
  }

  const rank = (r: Row): number => (r.ref ? 0 : r.id.includes(".") ? 1 : 2);
  const out: Record<string, ModelEntry> = {};
  for (const rows of groups.values()) {
    rows.sort((x, y) => rank(x) - rank(y) || x.id.localeCompare(y.id));
    const id = rows[0].id;
    let merged: ModelEntry = { ...rows[0].entry };
    for (const r of rows.slice(1)) merged = mergeEntries(merged, r.entry);
    merged = dropFakeArena({ ...merged, canonical_id: id, vendor: id.split("/")[0] });
    if (isOrphan(merged)) continue;
    merged.benchmark_sources = presentSources(merged);
    out[id] = merged;
  }
  return out;
}
