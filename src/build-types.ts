/**
 * build-types.ts — Shared types for the build pipeline.
 *
 * Extracted from build.ts so checks.ts and diff.ts can reference the
 * ModelEntry shape without creating an import cycle.
 */

export interface AlpacaLcEntry {
  winrate: number;
  lc_winrate: number;
  n: number;
}

export interface RouterAIModelEntry {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  input_rub_per_token: number;
  output_rub_per_token: number;
  input_usd_per_1m: number;
  output_usd_per_1m: number;
  supports_vision: boolean;
  supports_tools: boolean;
  supports_structured_output: boolean;
  reasoning: boolean;
}

export interface ModelEntry {
  canonical_id: string;
  display_name?: string;
  vendor?: string;
  /** Base metadata copied from models.dev, kept separate from supplements. */
  models_dev?: {
    provider_id: string;
    provider_name?: string;
    provider_api?: string;
    provider_doc?: string;
    model: Record<string, unknown>;
  };
  arena?: {
    elo: number;
    score: number;
    rank: number;
    leaderboard: string;
    ci: number;
    votes: number;
    confidence: string;
    license: string;
    sources: string[];
    last_updated?: string;
    fetched_at?: string;
  };
  alpaca_lc?: AlpacaLcEntry;
  routerai?: RouterAIModelEntry;
  hle?: {
    score: number;
    raw_score: number;
    date?: string;
    calibration_error?: number | null;
    provider?: string;
  };
  swebench_pro?: { score: number; raw_score: number; date?: string };
  swe_bench_verified?: { score: number; raw_score: number; date?: string };
  swe_bench_lite?: { score: number; raw_score: number; date?: string };
  swe_bench_multilingual?: { score: number; raw_score: number; date?: string };
  benchmark_sources: string[];
}

/** One model's primary coding benchmark result for coding-benchmarks.json. */
export interface CodingBenchmarkEntry {
  canonical_id: string;
  display_name: string;
  /** Stable machine-readable source key (for example, swebench_pro). */
  source: string;
  /** Human-readable benchmark name (for example, SWE-bench Pro). */
  benchmark: string;
  /** Alias retained for consumers that use an explicit *_name field. */
  benchmark_name: string;
  /** Score normalized to the [0, 1] scale used by supplement.json. */
  normalized_score: number;
  /** Short alias for consumers that expect a generic score field. */
  score: number;
  /** Original score as published by the benchmark source (usually percent). */
  raw_score: number;
  source_url: string;
  date?: string;
}

/** Compact manifest consumed by coding-model classifiers. */
export interface CodingBenchmarkManifest {
  schema_version: "1.0";
  generated_at: string;
  /** The artifact from which all records were derived. */
  source: "supplement.json";
  /** Preferred benchmark metric for classifiers and thresholding. */
  metric: "swebench_pro";
  models: Record<string, CodingBenchmarkEntry>;
  sources: Record<string, string>;
  provenance: {
    source_artifact: "supplement.json";
    source_sha256: string;
    source_generated_at?: string;
    source_git?: { commit: string | null; dirty: boolean; branch: string | null };
    source_fetches: Array<Record<string, unknown>>;
  };
}

export interface Unmatched {
  hle: Array<{ display_name: string; reason: string }>;
  swebench_pro: Array<{ display_name: string; reason: string }>;
  swe_bench_verified: Array<{ display_name: string; reason: string }>;
  swe_bench_lite: Array<{ display_name: string; reason: string }>;
  swe_bench_multilingual: Array<{ display_name: string; reason: string }>;
}
