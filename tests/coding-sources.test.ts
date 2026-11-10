import { expect, test } from "bun:test";
import { aggregateAiderVariants, canonicalCodingId, parseAiderYaml, parseHarborRow, parseLiveBenchCsv, type AiderVariant } from "../src/coding-sources";
import { buildCodingBenchmarkManifest } from "../src/coding-benchmarks";

test("Aider parser keeps pass rates and command provenance", () => {
  const rows = parseAiderYaml([
    "- dirname: 2025-10-03--fable",
    "  test_cases: 225",
    "  model: Claude Fable 5.2",
    "  pass_rate_1: 44.0",
    "  pass_rate_2: 55.5",
    "  command: aider --model anthropic/claude-fable-5.2",
    "  date: 2025-10-03",
  ].join("\n"));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    model: "Claude Fable 5.2",
    pass_rate_2: 55.5,
    command: "aider --model anthropic/claude-fable-5.2",
  });
});

test("LiveBench pinned release preserves Fable 5.2 as its own row", () => {
  const rows = parseLiveBenchCsv([
    "model,long_agentic,reasoning,coding,browser,data_analysis,research,design",
    "claude-fable-5.2,80.1,81.2,79.2,77.0,75.0,78.0,82.0",
    "claude-fable-5.1,82.0,84.0,89.7,80.0,76.0,80.0,83.0",
  ].join("\n"));
  const fable = rows.find((row) => row.model === "claude-fable-5.2");
  expect(fable).toMatchObject({ coding: "79.2" });
  expect(rows.find((row) => row.model === "claude-fable-5.1")?.coding).toBe("89.7");
});

test("new coding sources remain per-source slices and do not change SWE primary metric", () => {
  const supplement = {
    generated_at: "2026-11-10T00:00:00.000Z",
    models: {
      "anthropic/claude-fable-5.2": {
        canonical_id: "anthropic/claude-fable-5.2",
        display_name: "Claude Fable 5.2",
        swebench_pro: { score: 0.7, raw_score: 70 },
        aider_polyglot: { score: 0.55, raw_score: 55.5, source_url: "aider" },
        livebench: {
          score: 0.792,
          raw_score: 79.2,
          coding_score: 79.2,
          scores: { coding: 79.2 },
          release: "20261106",
          source_url: "livebench",
          categories_url: "categories",
        },
        terminal_bench: {
          score: 0.61,
          raw_score: 61,
          dataset: "terminal-bench-core",
          dataset_version: "0.1.1",
          agent: "swe-agent",
          runs: [],
          source_url: "terminal",
        },
        benchmark_sources: [],
      },
      "anthropic/claude-fable-5-2": {
        canonical_id: "anthropic/claude-fable-5-2",
        display_name: "Claude Fable 5.2",
        livebench: {
          score: 0.792,
          raw_score: 79.2,
          coding_score: 79.2,
          scores: { coding: 79.2 },
          release: "20261106",
          source_url: "livebench",
          categories_url: "categories",
        },
        benchmark_sources: [],
      },
    },
  };
  const manifest = buildCodingBenchmarkManifest(supplement, { generatedAt: "t" });
  const row = manifest.models["anthropic/claude-fable-5.2"];
  expect(row.benchmarks).toMatchObject({
    swebench_pro: { raw_score: 70 },
    aider_polyglot: { raw_score: 55.5 },
    livebench_coding: { raw_score: 79.2 },
    terminal_bench: { raw_score: 61 },
  });
  expect(manifest.metrics).toEqual([]);
  expect(row.coding).toBeUndefined();
  expect(manifest.sources.aider_polyglot).toContain("Aider-AI");
  expect(manifest.sources.livebench_coding).toContain("20261106");
  expect(manifest.models["anthropic/claude-fable-5-2"]).toMatchObject({
    source: "livebench_coding",
    raw_score: 79.2,
    benchmark: "LiveBench Coding (20261106)",
  });
  expect(manifest.models["anthropic/claude-fable-5-2"]?.coding).toBeUndefined();
});

test("Aider keeps sibling variants and records explicit aggregation", () => {
  const variants: AiderVariant[] = [
    { variant_id: "plain", score: 0.42, raw_score: 42, variant_type: "model", source_url: "aider" },
    { variant_id: "architect", score: 0.88, raw_score: 88, variant_type: "agent", source_url: "aider" },
    { variant_id: "plain-new", score: 0.55, raw_score: 55, variant_type: "model", source_url: "aider" },
  ];
  const entry = aggregateAiderVariants(variants);
  expect(entry.variants).toHaveLength(3);
  expect(entry.raw_score).toBe(55);
  expect(entry.aggregation).toBe("max_pass_rate_2");
});

test("Harbor TB2.1 row keeps Fable 5.2 and Astra model/agent/effort provenance", () => {
  const parsed = parseHarborRow({
    rank: 4,
    metadata: {
      model_display: { label: "Claude Fable 5.2", url: "https://anthropic.com" },
      agent_display: { label: "Terminus 2", url: "https://harborframework.com" },
      reasoning_effort: "high",
    },
    metrics: { accuracy: 79.2, pass_at_5: 0.84 },
  });
  expect(parsed?.id).toBe("anthropic/claude-fable-5.2");
  expect(parsed?.value).toMatchObject({
    model_display: "Claude Fable 5.2",
    agent_display: "Terminus 2",
    reasoning_effort: "high",
    accuracy: 79.2,
    rank: 4,
  });
});

test("coding canonicalizer merges Minimax M3p1 and xai spellings", () => {
  expect(canonicalCodingId(null, "Minimax M3p1 Flash")).toBe("minimax/minimax-m3.1-flash");
  expect(canonicalCodingId("xai", "grok-4.7")).toBe("x-ai/grok-4.7");
  expect(canonicalCodingId("x-ai", "grok-4.7")).toBe("x-ai/grok-4.7");
});
