/**
 * assemble.ts — pure: turn source results (live or failed) plus the previous
 * supplement into model entries, unmatched lists, source states and currency.
 *
 * A failed source adds nothing new; its fields are carried over from the
 * previous supplement and its state says so. All ids go through reconcileModels.
 */

import type { ModelEntry, Unmatched } from "./build-types";
import type { ArenaEntry } from "./arena";
import type { AlpacaLcEntry, RouterAIModelEntry } from "./build-types";
import type { ScoreEntry } from "./scores";
import type { ModelsDevRecord } from "./upstream";
import { canonicalId, displayNameFromRaw } from "./canonical";
import { reconcileModels } from "./merge";
import {
  SOURCE_FIELDS, carryFields, sourceState,
  type PreviousSupplement, type SourceResult, type SourceState,
} from "./source";

export interface AssembleInput {
  now: string;
  prev: PreviousSupplement | null;
  upstream: { models: Record<string, ModelsDevRecord>; ok: boolean; fallback: boolean; error?: string };
  arena: SourceResult<Record<string, ArenaEntry>>;
  alpaca: SourceResult<Record<string, AlpacaLcEntry>>;
  routerai: SourceResult<{ models: Record<string, RouterAIModelEntry>; currency: { usd_rub: number; source: string; fetched_at: string } | null }>;
  hle: SourceResult<{ hle: Record<string, ScoreEntry>; swebench_pro: Record<string, ScoreEntry> }>;
  swe: SourceResult<Record<"swe_bench_verified" | "swe_bench_lite" | "swe_bench_multilingual", Record<string, ScoreEntry>>>;
  urls: Record<string, string>;
}

export interface AssembleOutput {
  models: Record<string, ModelEntry>;
  unmatched: Unmatched;
  states: Record<string, SourceState>;
  currency: { usd_rub: number; source: string; fetched_at: string } | null;
}

function ensure(models: Record<string, ModelEntry>, id: string, displayName?: string): ModelEntry {
  const m = (models[id] ??= { canonical_id: id, vendor: id.split("/")[0], benchmark_sources: [] });
  if (displayName && !m.display_name) m.display_name = displayName;
  return m;
}

function splitId(raw: string): string | null {
  const slash = raw.indexOf("/");
  return slash < 0 ? canonicalId(null, raw) : canonicalId(raw.slice(0, slash), raw.slice(slash + 1));
}

export function assemble(i: AssembleInput): AssembleOutput {
  const fresh: Record<string, ModelEntry> = {};
  const unmatched: Unmatched = { hle: [], swebench_pro: [], swe_bench_verified: [], swe_bench_lite: [], swe_bench_multilingual: [] };
  const prevModels = i.prev?.models ?? {};
  const states: Record<string, SourceState> = {};

  // models.dev seeds the map under its own (reference) ids.
  for (const [id, up] of Object.entries(i.upstream.models)) {
    const name = typeof up.model.name === "string" ? up.model.name : undefined;
    ensure(fresh, id, name).models_dev = up;
  }
  states.upstream = {
    url: i.urls.upstream,
    status: i.upstream.ok ? "ok" : i.upstream.fallback ? "stale" : "absent",
    ...(i.upstream.ok ? { last_ok_at: i.now } : i.upstream.error ? { error: i.upstream.error } : {}),
  };

  const finish = (name: string, r: SourceResult<unknown>, carried: number) => {
    states[name] = sourceState({ url: i.urls[name], ok: r.ok, error: r.error, carried, prev: i.prev, name, now: i.now });
  };
  const carry = (name: string, r: SourceResult<unknown>): number => {
    if (r.ok) return 0;
    const n = carryFields(fresh, prevModels, SOURCE_FIELDS[name]);
    if (i.prev?.unmatched_display_names) {
      for (const f of SOURCE_FIELDS[name]) {
        const old = i.prev.unmatched_display_names[f];
        if (Array.isArray(old) && f in unmatched) (unmatched as unknown as Record<string, unknown[]>)[f] = old;
      }
    }
    return n;
  };

  // Arena: only real arena rows.
  if (i.arena.ok) {
    for (const [key, e] of Object.entries(i.arena.records)) {
      const cid = canonicalId(e.vendor, key);
      if (!cid || !(e.elo > 0)) continue;
      ensure(fresh, cid, displayNameFromRaw(key)).arena = {
        elo: e.elo, score: e.score, rank: e.rank, leaderboard: e.leaderboard, ci: e.ci, votes: e.votes,
        confidence: e.confidence, license: e.license, sources: e.sources,
        last_updated: e.lastUpdated, fetched_at: e.fetchedAt,
      };
    }
  }
  finish("arena", i.arena, carry("arena", i.arena));

  // AlpacaEval: attached by reconcileModels only if the model is otherwise known.
  if (i.alpaca.ok) {
    for (const [key, a] of Object.entries(i.alpaca.records)) {
      const cid = splitId(key);
      if (cid) ensure(fresh, cid, displayNameFromRaw(key)).alpaca_lc = a;
    }
  }
  finish("alpaca_lc", i.alpaca, carry("alpaca_lc", i.alpaca));

  if (i.routerai.ok) {
    for (const [key, e] of Object.entries(i.routerai.records.models)) {
      const cid = splitId(key);
      if (cid) ensure(fresh, cid, e.name).routerai = e;
    }
  }
  finish("routerai", i.routerai, carry("routerai", i.routerai));

  if (i.hle.ok) {
    for (const [field, set] of [["hle", i.hle.records.hle], ["swebench_pro", i.hle.records.swebench_pro]] as const) {
      for (const [key, e] of Object.entries(set)) {
        const provider = (e.extras?.provider as string | undefined) ?? undefined;
        const cid = canonicalId(provider, key);
        if (!cid) { unmatched[field].push({ display_name: e.raw_name, reason: "unknown_vendor" }); continue; }
        const m = ensure(fresh, cid, displayNameFromRaw(e.raw_name));
        if (field === "hle") {
          m.hle = { score: e.score, raw_score: e.raw_score, date: e.date,
            calibration_error: (e.extras?.calibration_error as number | null) ?? null, provider };
        } else {
          m.swebench_pro = { score: e.score, raw_score: e.raw_score, date: e.date };
        }
      }
    }
  }
  finish("hle", i.hle, carry("hle", i.hle));

  if (i.swe.ok) {
    for (const split of ["swe_bench_verified", "swe_bench_lite", "swe_bench_multilingual"] as const) {
      for (const [key, e] of Object.entries(i.swe.records[split])) {
        const cid = canonicalId(null, key);
        if (!cid) { unmatched[split].push({ display_name: e.raw_name, reason: "unknown_vendor" }); continue; }
        ensure(fresh, cid, displayNameFromRaw(e.raw_name))[split] = { score: e.score, raw_score: e.raw_score, date: e.date };
      }
    }
  }
  finish("swe_bench_leaderboard", i.swe, carry("swe_bench_leaderboard", i.swe));

  const currency = i.routerai.ok ? i.routerai.records.currency : i.prev?.currency ?? null;
  return { models: reconcileModels(fresh), unmatched, states, currency };
}
