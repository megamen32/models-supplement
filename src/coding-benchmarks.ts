/**
 * coding-benchmarks.ts — derive a small primary-score manifest from
 * supplement.json.
 *
 * The supplement keeps every coding split separately.  Consumers that only
 * need one coding signal should not have to know which split is available for
 * a model, so this manifest selects the first score in the documented order:
 * SWE-bench Pro, Verified, Lite, then Multilingual.
 */

import { sha256, type SourceFetch } from "./provenance";
import type {
  CodingBenchmarkEntry,
  CodingBenchmarkManifest,
  ModelEntry,
} from "./build-types";

export const CODING_BENCHMARK_SOURCES = {
  swebench_pro: "https://dashboard.safe.ai/api/models",
  swe_bench_verified:
    "https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json",
  swe_bench_lite:
    "https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json",
  swe_bench_multilingual:
    "https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json",
} as const;

const PRIMARY_ORDER = [
  { key: "swebench_pro", benchmark: "SWE-bench Pro" },
  { key: "swe_bench_verified", benchmark: "SWE-bench Verified" },
  { key: "swe_bench_lite", benchmark: "SWE-bench Lite" },
  { key: "swe_bench_multilingual", benchmark: "SWE-bench Multilingual" },
] as const;

type CodingModel = Pick<ModelEntry, "canonical_id" | "display_name"> & Partial<
  Pick<
    ModelEntry,
    | "swebench_pro"
    | "swe_bench_verified"
    | "swe_bench_lite"
    | "swe_bench_multilingual"
  >
>;

export interface CodingSupplementInput {
  generated_at?: string;
  models: Record<string, CodingModel>;
  sources?: Record<string, string | { url?: string }>;
  provenance?: {
    git?: { commit: string | null; dirty: boolean; branch: string | null };
    sources?: SourceFetch[];
  };
}

export interface CodingManifestOptions {
  /** Hash of the exact supplement.json bytes, when already serialized. */
  sourceSha256?: string;
  /** Override generated_at for deterministic tests or reproducible builds. */
  generatedAt?: string;
}

function hasFiniteScores(value: unknown): value is { score: number; raw_score: number; date?: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { score?: unknown; raw_score?: unknown; date?: unknown };
  return (
    typeof candidate.score === "number" && Number.isFinite(candidate.score) &&
    typeof candidate.raw_score === "number" && Number.isFinite(candidate.raw_score)
  );
}

function sourceUrl(
  key: keyof typeof CODING_BENCHMARK_SOURCES,
  supplementSources?: Record<string, string | { url?: string }>,
): string {
  const url = (v: string | { url?: string } | undefined): string | undefined =>
    typeof v === "string" ? v : v?.url;
  // Keep source URLs in sync with supplement.json when a caller has customized
  // them, while retaining authoritative defaults for hand-built fixtures.
  if (key === "swebench_pro") return url(supplementSources?.hle) ?? CODING_BENCHMARK_SOURCES[key];
  return url(supplementSources?.swe_bench_leaderboard) ?? CODING_BENCHMARK_SOURCES[key];
}

/**
 * Build coding-benchmarks.json data without reading or writing files.
 *
 * Models with no finite coding score are omitted.  A score of zero is valid
 * and is retained; availability is determined by the field, not truthiness.
 */
export function buildCodingBenchmarkManifest(
  supplement: CodingSupplementInput,
  options: CodingManifestOptions = {},
): CodingBenchmarkManifest {
  const models: Record<string, CodingBenchmarkEntry> = {};
  const sourceUrls: Record<string, string> = { ...CODING_BENCHMARK_SOURCES };

  for (const canonicalId of Object.keys(supplement.models).sort()) {
    const model = supplement.models[canonicalId];
    if (!model) continue;

    for (const candidate of PRIMARY_ORDER) {
      const score = model[candidate.key];
      if (!hasFiniteScores(score)) continue;

      const displayName = model.display_name?.trim() || canonicalId;
      const url = sourceUrl(candidate.key, supplement.sources);
      sourceUrls[candidate.key] = url;
      models[canonicalId] = {
        canonical_id: canonicalId,
        display_name: displayName,
        source: candidate.key,
        benchmark: candidate.benchmark,
        benchmark_name: candidate.benchmark,
        normalized_score: score.score,
        score: score.score,
        raw_score: score.raw_score,
        source_url: url,
        ...(typeof score.date === "string" && score.date.length > 0 ? { date: score.date } : {}),
      };
      break;
    }
  }

  const sourceText = JSON.stringify(supplement, null, 2);
  const sourceFetches = (supplement.provenance?.sources ?? [])
    .filter((entry) =>
      entry.name === "cais_dashboard" ||
      entry.name === "swe_bench_leaderboard" ||
      entry.name === "hle_api",
    )
    .map((entry) => ({ ...entry }));

  return {
    schema_version: "1.0",
    generated_at: options.generatedAt ?? supplement.generated_at ?? new Date().toISOString(),
    source: "supplement.json",
    metric: "swebench_pro",
    models,
    sources: sourceUrls,
    provenance: {
      source_artifact: "supplement.json",
      source_sha256: options.sourceSha256 ?? sha256(sourceText),
      ...(supplement.generated_at ? { source_generated_at: supplement.generated_at } : {}),
      ...(supplement.provenance?.git ? { source_git: supplement.provenance.git } : {}),
      source_fetches: sourceFetches,
    },
  };
}

