import { expect, test } from "bun:test";
import { parseAiderYaml, parseLiveBenchCsv } from "../src/coding-sources";
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
});
