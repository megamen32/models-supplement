import { expect, test } from "bun:test";
import { runChecks } from "../src/checks";
import type { ModelEntry } from "../src/build-types";

const md = { provider_id: "p", model: {} };
const models = (n: number): Record<string, ModelEntry> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`v/m${i}`, {
    canonical_id: `v/m${i}`, benchmark_sources: [], models_dev: md,
    hle: { score: 0.1, raw_score: 10 }, swe_bench_verified: { score: 0.1, raw_score: 10 },
  } as ModelEntry]));

const okSrc = { status: "ok" as const };
const base = { currency: { usd_rub: 90, source: "t" }, upstream: { model_count: 30, live: true } };

test("stale or absent sources are warnings, not errors, even when their data is thin", () => {
  const r = runChecks({
    ...base, models: models(30),
    sources: { arena: { status: "absent", error: "HTTP 429" }, routerai: { status: "stale", error: "HTTP 500" },
      hle: okSrc, swe_bench_leaderboard: okSrc, alpaca_lc: okSrc },
  });
  expect(r.errors).toEqual([]);
  expect(r.ok).toBe(true);
  expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["source_absent", "source_stale"]));
});

test("a live source that collapsed is still an error", () => {
  const r = runChecks({
    ...base, models: models(3),
    sources: { arena: okSrc, routerai: okSrc, hle: okSrc, swe_bench_leaderboard: okSrc, alpaca_lc: okSrc },
  });
  expect(r.errors.map((e) => e.code)).toEqual(expect.arrayContaining(["arena_underflow", "routerai_underflow", "hle_underflow"]));
});

test("duplicate ids fail the check", () => {
  const m = { ...models(2), "a/b-1.2": { canonical_id: "a/b-1.2", benchmark_sources: [] } as ModelEntry,
    "a/b-1-2": { canonical_id: "a/b-1-2", benchmark_sources: [] } as ModelEntry };
  const r = runChecks({ ...base, models: m, sources: {} });
  expect(r.errors.map((e) => e.code)).toContain("duplicate_canonical_id");
});

test("missing currency is a warning when routerai is not live", () => {
  const r = runChecks({ upstream: base.upstream, currency: null, models: models(30), sources: { routerai: { status: "absent" } } });
  expect(r.errors.map((e) => e.code)).not.toContain("currency_invalid");
});
