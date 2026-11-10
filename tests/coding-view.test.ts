import { expect, test } from "bun:test";
import { buildCodingBenchmarkManifest, isScaffold, percentile, COVERAGE_FLAGSHIPS } from "../src/coding-benchmarks";

const m = (id: string, extra: object) => ({ canonical_id: id, display_name: id.split("/")[1], benchmark_sources: [], ...extra });
const pro = (raw: number) => ({ swebench_pro: { score: raw / 100, raw_score: raw } });
const ver = (raw: number) => ({ swe_bench_verified: { score: raw / 100, raw_score: raw } });

test("percentile: top 100, bottom 0, ties share the mid-rank, single model 50", () => {
  const all = [10, 20, 30, 40, 50];
  expect(percentile(50, all)).toBe(100);
  expect(percentile(10, all)).toBe(0);
  expect(percentile(30, all)).toBe(50);
  expect(percentile(20, [20, 20, 30])).toBe(25);
  expect(percentile(7, [7])).toBe(50);
});

test("scaffold rows are recognised", () => {
  expect(isScaffold("perplexity/sonar-foundation-agent-+-claude-4.5-opus", "Claude 4.5 Opus")).toBe(true);
  expect(isScaffold("alibaba/lingxi-v1.5-x-kimi-k2", "Lingxi v1.5 x Kimi K2")).toBe(true);
  expect(isScaffold("nvidia/nemotron-cortexa", "Nemotron-CORTEXA")).toBe(true);
  expect(isScaffold("x/y", "Foo + Bar")).toBe(true);
  expect(isScaffold("anthropic/claude-opus-4.5", "Claude Opus 4.5")).toBe(false);
});

function fixture() {
  const models: Record<string, ReturnType<typeof m>> = {};
  // five models on Pro, five on Verified; "mixed" is only on Verified
  [["a", 60], ["b", 50], ["c", 40], ["d", 30], ["e", 20]].forEach(([k, v]) => { models[`v/${k}`] = m(`v/${k}`, pro(v as number)); });
  [["a", 90], ["b", 80], ["c", 70], ["f", 60], ["g", 50]].forEach(([k, v]) => { models[`v/${k}`] = m(`v/${k}`, { ...(models[`v/${k}`] ?? {}), ...ver(v as number) }); });
  models["p/sonar-agent-+-x"] = m("p/sonar-agent-+-x", pro(99));
  models["v/none"] = m("v/none", {});
  return models;
}

test("coding.score is the mean of per-benchmark percentiles; scaffolds are listed apart; no guess without a benchmark", () => {
  const out = buildCodingBenchmarkManifest({ generated_at: "t", models: fixture() }, { generatedAt: "t" });
  expect(out.metric).toBe("swebench_pro");
  expect(out.metrics).toEqual(["swebench_pro", "swe_bench_verified"]);
  expect(out.models["p/sonar-agent-+-x"]).toBeUndefined();
  expect(out.scaffolds.map((s) => s.canonical_id)).toEqual(["p/sonar-agent-+-x"]);
  expect(out.models["v/none"]).toBeUndefined();
  const a = out.models["v/a"];
  expect(a.coding).toEqual({ score: 100, basis: ["swebench_pro", "swe_bench_verified"], rank: 1, of: 7 });
  expect(a.benchmarks.swebench_pro?.raw_score).toBe(60);
  expect(a.benchmarks.swe_bench_verified?.raw_score).toBe(90);
  // old fields kept
  expect(a).toMatchObject({ source: "swebench_pro", normalized_score: 0.6, score: 0.6, raw_score: 60 });
  // d: Pro 25 only; f: Verified 25 only
  expect(out.models["v/d"].coding?.basis).toEqual(["swebench_pro"]);
  expect(out.models["v/d"].coding?.score).toBe(25);
  expect(out.models["v/f"].coding?.score).toBe(25);
  expect(out.models["v/d"].coding?.rank).toBe(out.models["v/f"].coding?.rank);
});

test("coverage names the flagships and says which have a coding score", () => {
  const models = fixture();
  models["anthropic/claude-opus-5-5"] = m("anthropic/claude-opus-5-5", { hle: { score: 0.5, raw_score: 50 } });
  models["xai/grok-4.7"] = m("xai/grok-4.7", ver(55));
  const out = buildCodingBenchmarkManifest({ generated_at: "t", models }, { generatedAt: "t" });
  expect(Object.keys(out.coverage)).toHaveLength(12);
  expect(COVERAGE_FLAGSHIPS).toHaveLength(12);
  expect(out.coverage["anthropic/claude-opus-5.5"]).toEqual({ present: true, scored: false, id: "anthropic/claude-opus-5-5" });
  expect(out.coverage["x-ai/grok-4.7"]).toMatchObject({ present: true, scored: true, benchmarks: ["swe_bench_verified"], id: "xai/grok-4.7" });
  expect(out.coverage["openai/gpt-6-astra"]).toEqual({ present: false, scored: false });
});
