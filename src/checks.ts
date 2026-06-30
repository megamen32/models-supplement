/**
 * checks.ts — Post-merge sanity checks on the assembled supplement.
 *
 * Inspired by llm-inference-benchmark's "sanity checks" section: the harness
 * there warned that throughput is meaningless if the model degenerates.
 * Same idea here: counts and pricing are meaningless if the upstream feed
 * collapsed (parse error, rate limit, 5xx, schema drift).
 *
 * Returns a structured report; build.ts decides whether to fail the build
 * based on severity.
 */

import type { ModelEntry } from "./build-types";

export interface CheckIssue {
  severity: "error" | "warn";
  code: string;
  message: string;
}

export interface CheckReport {
  ok: boolean;
  errors: CheckIssue[];
  warnings: CheckIssue[];
  stats: CheckStats;
}

export interface CheckStats {
  total_models: number;
  with_arena: number;
  with_alpaca_lc: number;
  with_routerai: number;
  with_hle: number;
  with_swe_pro: number;
  with_swe_verified: number;
  with_swe_lite: number;
  with_swe_multilingual: number;
  duplicate_canonical_ids: number;
  usd_rub: number | null;
  unmatched_hle: number;
  unmatched_swe: number;
}

export interface Unmatched {
  hle: Array<{ display_name: string; reason: string }>;
  swebench_pro: Array<{ display_name: string; reason: string }>;
  swe_bench_verified: Array<{ display_name: string; reason: string }>;
  swe_bench_lite: Array<{ display_name: string; reason: string }>;
  swe_bench_multilingual: Array<{ display_name: string; reason: string }>;
}

export interface CheckInput {
  arena: Record<string, unknown>;
  routerai: Record<string, unknown>;
  currency: { usd_rub: number; source: string };
  models?: Record<string, ModelEntry>;
  unmatched?: Unmatched;
}

/** Minimum counts we expect from healthy sources. Tuned to catch outages. */
const MIN_ARENA = 50;
const MIN_ROUTERAI = 50;
const MIN_HLE = 5;
const MIN_SWE_VERIFIED = 20;
const MIN_SWE_LITE = 10;
const MIN_SWE_MULTILINGUAL = 5;

export function runChecks(input: CheckInput): CheckReport {
  const errors: CheckIssue[] = [];
  const warnings: CheckIssue[] = [];

  const arenaEntries = Object.keys(input.arena).length;
  const routeraiEntries = Object.keys(input.routerai).length;

  if (arenaEntries < MIN_ARENA) {
    errors.push({
      severity: "error",
      code: "arena_underflow",
      message: `arena has ${arenaEntries} entries, expected >= ${MIN_ARENA} (source likely down)`,
    });
  }
  if (routeraiEntries < MIN_ROUTERAI) {
    errors.push({
      severity: "error",
      code: "routerai_underflow",
      message: `routerai has ${routeraiEntries} models, expected >= ${MIN_ROUTERAI} (source likely down)`,
    });
  }

  const rate = input.currency.usd_rub;
  if (!Number.isFinite(rate) || rate <= 0) {
    errors.push({
      severity: "error",
      code: "currency_invalid",
      message: `USD/RUB rate is ${rate}, expected positive number`,
    });
  } else if (rate < 30 || rate > 300) {
    warnings.push({
      severity: "warn",
      code: "currency_outlier",
      message: `USD/RUB rate ${rate} is outside plausible range 30..300`,
    });
  }

  // Models view stats
  const models = input.models ?? {};
  const totalModels = Object.keys(models).length;
  let withArena = 0, withAlpaca = 0, withRouterai = 0, withHle = 0;
  let withSwePro = 0, withSweVerified = 0, withSweLite = 0, withSweMulti = 0;
  let arenaMissing = 0, routeraiMissing = 0;
  let routeraiWithUsd = 0;

  for (const [cid, m] of Object.entries(models)) {
    if (m.arena) withArena++;
    if (m.alpaca_lc) withAlpaca++;
    if (m.routerai) {
      withRouterai++;
      if ((m.routerai.input_usd_per_1m ?? 0) > 0 || (m.routerai.output_usd_per_1m ?? 0) > 0) {
        routeraiWithUsd++;
      }
      if (typeof m.routerai.id !== "string" || m.routerai.id.length === 0) routeraiMissing++;
    }
    if (m.hle) withHle++;
    if (m.swebench_pro) withSwePro++;
    if (m.swe_bench_verified) withSweVerified++;
    if (m.swe_bench_lite) withSweLite++;
    if (m.swe_bench_multilingual) withSweMulti++;

    // Schema checks on arena subrecord
    if (m.arena) {
      if (typeof m.arena.score !== "number" || !Array.isArray(m.arena.sources) || m.arena.sources.length === 0) {
        arenaMissing++;
      }
    }
    // Validate canonical_id format
    if (!cid.includes("/")) {
      errors.push({
        severity: "error",
        code: "bad_canonical_id",
        message: `model entry has no vendor prefix: ${cid}`,
      });
    }
  }

  if (arenaMissing > 0) {
    errors.push({
      severity: "error",
      code: "arena_schema_drift",
      message: `${arenaMissing} model entries have malformed arena subrecord (missing score/sources)`,
    });
  }
  if (routeraiMissing > 0) {
    errors.push({
      severity: "error",
      code: "routerai_schema_drift",
      message: `${routeraiMissing} routerai entries missing required field 'id'`,
    });
  }
  if (withRouterai > 0 && routeraiWithUsd / withRouterai < 0.5) {
    warnings.push({
      severity: "warn",
      code: "routerai_low_priced",
      message: `only ${routeraiWithUsd}/${withRouterai} routerai entries have non-zero USD pricing (>50% free/unpriced)`,
    });
  }

  // Benchmark coverage thresholds
  if (withHle < MIN_HLE) {
    errors.push({
      severity: "error",
      code: "hle_underflow",
      message: `HLE has ${withHle} entries, expected >= ${MIN_HLE}`,
    });
  }
  if (withSweVerified < MIN_SWE_VERIFIED) {
    errors.push({
      severity: "error",
      code: "swe_verified_underflow",
      message: `SWE-bench Verified has ${withSweVerified} entries, expected >= ${MIN_SWE_VERIFIED}`,
    });
  }
  if (withSweLite < MIN_SWE_LITE) {
    warnings.push({
      severity: "warn",
      code: "swe_lite_underflow",
      message: `SWE-bench Lite has ${withSweLite} entries, expected >= ${MIN_SWE_LITE}`,
    });
  }
  if (withSweMulti < MIN_SWE_MULTILINGUAL) {
    warnings.push({
      severity: "warn",
      code: "swe_multilingual_underflow",
      message: `SWE-bench Multilingual has ${withSweMulti} entries, expected >= ${MIN_SWE_MULTILINGUAL}`,
    });
  }

  // Unmatched display names — informational, not blocking
  const unmatched = input.unmatched;
  const unmatchedHle = unmatched?.hle.length ?? 0;
  const unmatchedSwe = (unmatched?.swe_bench_verified.length ?? 0) +
                       (unmatched?.swe_bench_lite.length ?? 0) +
                       (unmatched?.swe_bench_multilingual.length ?? 0);
  if (unmatched && unmatchedHle > 0) {
    warnings.push({
      severity: "warn",
      code: "unmatched_hle",
      message: `${unmatchedHle} HLE entries could not be mapped to canonical (vendor unknown)`,
    });
  }
  if (unmatched && unmatchedSwe > 0) {
    warnings.push({
      severity: "warn",
      code: "unmatched_swe",
      message: `${unmatchedSwe} SWE-bench entries could not be mapped to canonical (likely agent systems, not models)`,
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      total_models: totalModels,
      with_arena: withArena,
      with_alpaca_lc: withAlpaca,
      with_routerai: withRouterai,
      with_hle: withHle,
      with_swe_pro: withSwePro,
      with_swe_verified: withSweVerified,
      with_swe_lite: withSweLite,
      with_swe_multilingual: withSweMulti,
      duplicate_canonical_ids: 0,
      usd_rub: Number.isFinite(rate) ? rate : null,
      unmatched_hle: unmatchedHle,
      unmatched_swe: unmatchedSwe,
    },
  };
}

/** Format the report for human-readable output (CLI / --dry-run). */
export function formatReport(r: CheckReport): string {
  const lines: string[] = [];
  lines.push("=== sanity checks ===");
  for (const e of r.errors)   lines.push(`  ERROR  [${e.code}] ${e.message}`);
  for (const w of r.warnings) lines.push(`  WARN   [${w.code}] ${w.message}`);
  if (r.errors.length === 0 && r.warnings.length === 0) {
    lines.push("  all checks passed");
  }
  lines.push("");
  lines.push("=== stats ===");
  lines.push(`  total models:          ${r.stats.total_models}`);
  lines.push(`    with arena:          ${r.stats.with_arena}`);
  lines.push(`    with alpaca_lc:      ${r.stats.with_alpaca_lc}`);
  lines.push(`    with routerai:       ${r.stats.with_routerai}`);
  lines.push(`    with hle:            ${r.stats.with_hle}`);
  lines.push(`    with swebench_pro:   ${r.stats.with_swe_pro}`);
  lines.push(`    with swe_verified:   ${r.stats.with_swe_verified}`);
  lines.push(`    with swe_lite:       ${r.stats.with_swe_lite}`);
  lines.push(`    with swe_multiling:  ${r.stats.with_swe_multilingual}`);
  lines.push(`  USD/RUB:               ${r.stats.usd_rub ?? "(none)"}`);
  lines.push(`  unmatched:             hle=${r.stats.unmatched_hle}  swe=${r.stats.unmatched_swe}`);
  return lines.join("\n");
}