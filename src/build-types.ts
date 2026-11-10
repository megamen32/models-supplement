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

export interface ArenaBoard {
  elo: number;
  score: number;
  rank: number;
  ci: number;
  votes: number;
  confidence: string;
  license: string;
  last_updated?: string;
}

export interface ModelEntry {
  canonical_id: string;
  display_name?: string;
  vendor?: string;
  arena?: { text?: ArenaBoard; code?: ArenaBoard };
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

/** Leaderboard names that matched no model, keyed by field ("hle", "swe_bench_verified", …). */
export type Unmatched = Record<string, Array<{ display_name: string; reason: string; kind?: "scaffold" | "model" }>>;
