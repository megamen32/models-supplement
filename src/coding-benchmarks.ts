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
import { idKey } from "./canonical";
import type {
  CodingBenchmarkEntry,
  CodingBenchmarkManifest,
  CodingCoverageRow,
  CodingScaffoldRow,
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
  aider_polyglot:
    "https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml",
  livebench_coding: "https://livebench.ai/data/20261106/table.csv",
  terminal_bench:
    "https://github.com/laude-institute/terminal-bench-leaderboard/tree/main/results/terminal-bench-core@0.1.1",
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
    | "aider_polyglot"
    | "livebench"
    | "terminal_bench"
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
  const sourceKey =
    key === "swebench_pro" ? "hle" :
    key.startsWith("swe_bench_") ? "swe_bench_leaderboard" :
    key;
  return url(supplementSources?.[sourceKey]) ?? CODING_BENCHMARK_SOURCES[key];
}

/** Benchmarks with fewer ranked models than this do not enter coding.score. */
export const MIN_BENCHMARK_MODELS = 5;

/** Current flagships whose coding score a reader will look for. */
export const COVERAGE_FLAGSHIPS = [
  "anthropic/claude-fable-5.2", "anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5.5",
  "anthropic/claude-haiku-5.5", "openai/gpt-6-astra", "openai/gpt-6.1-sol", "openai/gpt-6.1-terra",
  "openai/gpt-6-luna", "z-ai/glm-5.3", "z-ai/glm-5.3-flash", "x-ai/grok-4.7", "minimax/minimax-m3.1-flash",
] as const;

const SCAFFOLD_PATTERNS: RegExp[] = [
  /\s\+\s|-\+-/,        // "X + Claude ..."
  /agent/i,                // "...-agent-...", "SWE-agent"
  /lingxi|cortexa/i,       // agent products named after the product, not the model
  /review-heavy|\bw\//i,   // "Claude 3.7 Sonnet w/ Review Heavy"
];

/** Pure: a leaderboard row that is an agent scaffold rather than a model. */
export function isScaffold(canonicalId: string, displayName?: string): boolean {
  const text = `${canonicalId} ${displayName ?? ""}`;
  return SCAFFOLD_PATTERNS.some((re) => re.test(text));
}

/** Pure: 0-100 standing of `value` among `all` (which contains it). Ties share the mid-rank. */
export function percentile(value: number, all: number[]): number {
  const n = all.length;
  if (n <= 1) return 50;
  const less = all.filter((v) => v < value).length;
  const equal = all.filter((v) => v === value).length;
  return (100 * (less + 0.5 * (equal - 1))) / (n - 1);
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

type Benchmarks = Record<string, { score: number; raw_score: number; date?: string }>;

function scoresOf(model: CodingModel): Benchmarks {
  const out: Benchmarks = {};
  for (const { key } of PRIMARY_ORDER) {
    const v = model[key];
    if (hasFiniteScores(v)) {
      out[key] = { score: v.score, raw_score: v.raw_score, ...(typeof v.date === "string" && v.date ? { date: v.date } : {}) };
    }
  }

  // These sources stay as independent slices in benchmarks. They are
  // intentionally excluded from PRIMARY_ORDER and therefore never alter
  // coding.score or the SWE-bench Pro threshold used by classifiers.
  const aider = model.aider_polyglot;
  if (hasFiniteScores(aider)) {
    out.aider_polyglot = {
      score: aider.score,
      raw_score: aider.raw_score,
      ...(typeof aider.date === "string" && aider.date ? { date: aider.date } : {}),
    };
  }
  const livebench = model.livebench;
  if (livebench && Number.isFinite(livebench.coding_score)) {
    out.livebench_coding = {
      score: livebench.coding_score / 100,
      raw_score: livebench.coding_score,
    };
  }
  const terminal = model.terminal_bench;
  if (hasFiniteScores(terminal)) {
    out.terminal_bench = {
      score: terminal.score,
      raw_score: terminal.raw_score,
    };
  }
  return out;
}

/**
 * Build coding-benchmarks.json data without reading or writing files.
 *
 * Models with no finite coding score are omitted.  A score of zero is valid
 * and is retained; availability is determined by the field, not truthiness.
 * Scaffold rows are listed in `scaffolds` and never ranked.  `coding.score`
 * is the mean of per-benchmark percentiles, so benchmarks on different
 * scales are never averaged raw.
 */
export function buildCodingBenchmarkManifest(
  supplement: CodingSupplementInput,
  options: CodingManifestOptions = {},
): CodingBenchmarkManifest {
  const models: Record<string, CodingBenchmarkEntry> = {};
  const scaffolds: CodingScaffoldRow[] = [];
  const sourceUrls: Record<string, string> = { ...CODING_BENCHMARK_SOURCES };
  const bench = new Map<string, Benchmarks>();

  for (const canonicalId of Object.keys(supplement.models).sort()) {
    const model = supplement.models[canonicalId];
    if (!model) continue;
    const benchmarks = scoresOf(model);
    if (Object.keys(benchmarks).length === 0) continue;
    const displayName = model.display_name?.trim() || canonicalId;
    if (isScaffold(canonicalId, displayName)) {
      scaffolds.push({ canonical_id: canonicalId, display_name: displayName, benchmarks });
      continue;
    }
    bench.set(canonicalId, benchmarks);

    for (const candidate of PRIMARY_ORDER) {
      const score = benchmarks[candidate.key];
      if (!score) continue;
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
        ...(score.date ? { date: score.date } : {}),
        benchmarks,
      };
      break;
    }
  }

  // Per-benchmark score lists over real models only, then percentile mean.
  const lists = new Map<string, number[]>();
  for (const b of bench.values()) {
    for (const [k, v] of Object.entries(b)) lists.set(k, [...(lists.get(k) ?? []), v.raw_score]);
  }
  const metrics = PRIMARY_ORDER.map((p) => p.key as string).filter((k) => (lists.get(k)?.length ?? 0) >= MIN_BENCHMARK_MODELS);
  const standing = new Map<string, { score: number; basis: string[] }>();
  for (const [id, b] of bench) {
    const basis = metrics.filter((k) => b[k]);
    if (basis.length === 0) continue;
    const mean = basis.reduce((s, k) => s + percentile(b[k].raw_score, lists.get(k)!), 0) / basis.length;
    standing.set(id, { score: round1(mean), basis });
  }
  const ranked = [...standing.values()].map((v) => v.score).sort((a, b) => b - a);
  for (const [id, st] of standing) {
    models[id].coding = { score: st.score, basis: st.basis, rank: ranked.findIndex((v) => v === st.score) + 1, of: ranked.length };
  }

  const coverage: Record<string, CodingCoverageRow> = {};
  const byKey = new Map(Object.keys(supplement.models).map((id) => [idKey(id), id]));
  for (const flagship of COVERAGE_FLAGSHIPS) {
    const found = byKey.get(idKey(flagship));
    if (!found) { coverage[flagship] = { present: false, scored: false }; continue; }
    const have = Object.keys(scoresOf(supplement.models[found]!));
    coverage[flagship] = have.length > 0
      ? { present: true, scored: true, benchmarks: have, ...(found !== flagship ? { id: found } : {}) }
      : { present: true, scored: false, ...(found !== flagship ? { id: found } : {}) };
  }

  const sourceText = JSON.stringify(supplement, null, 2);
  const sourceFetches = (supplement.provenance?.sources ?? [])
    .filter((entry) =>
      entry.name === "cais_dashboard" ||
      entry.name === "swe_bench_leaderboard" ||
      entry.name === "hle_api" ||
      entry.name === "aider_polyglot" ||
      entry.name === "livebench:table" ||
      entry.name === "livebench:categories" ||
      entry.name === "terminal_bench:root" ||
      entry.name === "terminal_bench:listing" ||
      entry.name === "terminal_bench:metadata",
    )
    .map((entry) => ({ ...entry }));

  return {
    schema_version: "1.1",
    generated_at: options.generatedAt ?? supplement.generated_at ?? new Date().toISOString(),
    source: "supplement.json",
    metric: "swebench_pro",
    metrics,
    models,
    scaffolds,
    coverage,
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
