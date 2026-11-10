import { expect, test } from "bun:test";
import { assemble, type AssembleInput } from "../src/assemble";
import type { ModelEntry } from "../src/build-types";

const failed = { ok: false, records: {}, error: "HTTP 429", stats: [] };
const urls = { upstream: "u0", arena: "u1", alpaca_lc: "u2", routerai: "u3", hle: "u4", swe_bench_leaderboard: "u5" };
const md = { provider_id: "anthropic", model: { id: "claude-opus-5-5", name: "Claude Opus 5.5" } };

function input(over: Partial<AssembleInput>): AssembleInput {
  return {
    now: "2026-11-10T00:00:00Z", prev: null,
    upstream: { models: { "anthropic/claude-opus-5-5": md }, ok: true, fallback: false },
    arena: failed, alpaca: failed, routerai: { ...failed, records: { models: {}, currency: null } },
    hle: { ...failed, records: { hle: {}, swebench_pro: {} } },
    swe: { ...failed, records: { swe_bench_verified: {}, swe_bench_lite: {}, swe_bench_multilingual: {} } },
    urls, ...over,
  } as AssembleInput;
}

const prev = {
  generated_at: "2026-11-09T00:00:00Z",
  currency: { usd_rub: 80, source: "CBR", fetched_at: "2026-11-09T00:00:00Z" },
  models: {
    "anthropic/claude-opus-5.5": { canonical_id: "anthropic/claude-opus-5.5", benchmark_sources: [],
      routerai: { id: "r", input_usd_per_1m: 5 } } as unknown as ModelEntry,
    "anthropic/claude-opus-5-5": { canonical_id: "anthropic/claude-opus-5-5", benchmark_sources: [],
      hle: { score: 0.55, raw_score: 55 } } as ModelEntry,
    "unknown/nullmodel": { canonical_id: "unknown/nullmodel", benchmark_sources: [],
      arena: { elo: 0, score: 0.8, sources: ["alpaca_lc"] }, alpaca_lc: { winrate: 1, lc_winrate: 1, n: 1 } } as unknown as ModelEntry,
  },
};

test("all fetches failed: fields carried from the previous file, one merged entry, states stale/absent", () => {
  const out = assemble(input({ prev }));
  expect(Object.keys(out.models)).toEqual(["anthropic/claude-opus-5-5"]);
  const m = out.models["anthropic/claude-opus-5-5"];
  expect(m.routerai).toBeDefined();
  expect(m.hle?.raw_score).toBe(55);
  expect(m.models_dev).toBeDefined();
  expect(m.arena).toBeUndefined();
  expect(out.states.routerai.status).toBe("stale");
  expect(out.states.hle.status).toBe("stale");
  expect(out.states.arena.status).toBe("absent");
  expect(out.states.arena.error).toBe("HTTP 429");
  expect(out.currency?.usd_rub).toBe(80);
});

test("no previous file: failed sources add nothing and are absent", () => {
  const out = assemble(input({}));
  const m = out.models["anthropic/claude-opus-5-5"];
  expect(m.routerai).toBeUndefined();
  expect(m.hle).toBeUndefined();
  expect(out.states.routerai.status).toBe("absent");
  expect(out.currency).toBeNull();
});

test("alpaca rows matching no known model are dropped; arena field only with real elo", () => {
  const out = assemble(input({
    alpaca: { ok: true, stats: [], records: { "nullmodel": { winrate: 1, lc_winrate: 1, n: 1 }, "claude-opus-5.5": { winrate: 0.5, lc_winrate: 0.6, n: 800 } } },
    arena: { ok: true, stats: [], records: { "claude-opus-5-5": { elo: 1500, score: 0.9, rank: 1, leaderboard: "text", ci: 1, votes: 10, vendor: "Anthropic", license: "", confidence: "low", categories: [], sources: ["arena"] } } },
  }));
  expect(Object.keys(out.models)).toEqual(["anthropic/claude-opus-5-5"]);
  const m = out.models["anthropic/claude-opus-5-5"];
  expect(m.alpaca_lc?.lc_winrate).toBe(0.6);
  expect(m.arena?.elo).toBe(1500);
  expect(out.states.arena.status).toBe("ok");
});
