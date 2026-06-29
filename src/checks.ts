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

export interface CheckIssue {
  severity: "error" | "warn";
  code: string;
  message: string;
}

export interface CheckReport {
  ok: boolean;
  errors: CheckIssue[];
  warnings: CheckIssue[];
  stats: {
    arena_entries: number;
    routerai_entries: number;
    arena_with_alpaca: number;
    routerai_with_usd: number;
    duplicate_keys: number;
    usd_rub: number | null;
    hle_entries: number;
    swe_verified_entries: number;
    swe_lite_entries: number;
    swe_multilingual_entries: number;
  };
}

export interface CheckInput {
  arena: Record<string, unknown>;
  routerai: Record<string, unknown>;
  currency: { usd_rub: number; source: string };
  benchmark_scores?: {
    hle: Record<string, unknown>;
    swe_bench_verified: Record<string, unknown>;
    swe_bench_lite: Record<string, unknown>;
    swe_bench_multilingual: Record<string, unknown>;
  };
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

  // 1. Minimum counts — source outage detection
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

  // 2. Currency sanity
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

  // 3. Duplicate detection — same key appears as both arena entry and routerai model
  //    Not strictly wrong, but consumers may treat keys as global; flag for review.
  let duplicates = 0;
  for (const k of Object.keys(input.arena)) {
    if (Object.prototype.hasOwnProperty.call(input.routerai, k)) duplicates++;
  }
  if (duplicates > 0) {
    warnings.push({
      severity: "warn",
      code: "key_collision",
      message: `${duplicates} key(s) appear in both arena and routerai — consumers may need to disambiguate`,
    });
  }

  // 4. Required fields per arena entry
  let arenaMissing = 0;
  for (const [k, v] of Object.entries(input.arena)) {
    const e = v as { score?: number; sources?: string[] };
    if (typeof e.score !== "number" || !Array.isArray(e.sources) || e.sources.length === 0) {
      arenaMissing++;
    }
  }
  if (arenaMissing > 0) {
    errors.push({
      severity: "error",
      code: "arena_schema_drift",
      message: `${arenaMissing} arena entries missing required fields (score/sources)`,
    });
  }

  // 5. Required fields per routerai entry
  let routeraiMissing = 0;
  let routeraiWithUsd = 0;
  for (const [k, v] of Object.entries(input.routerai)) {
    const e = v as { id?: string; input_usd_per_1m?: number; output_usd_per_1m?: number };
    if (typeof e.id !== "string" || e.id.length === 0) {
      routeraiMissing++;
      continue;
    }
    if ((e.input_usd_per_1m ?? 0) > 0 || (e.output_usd_per_1m ?? 0) > 0) {
      routeraiWithUsd++;
    }
  }
  if (routeraiMissing > 0) {
    errors.push({
      severity: "error",
      code: "routerai_schema_drift",
      message: `${routeraiMissing} routerai entries missing required field 'id'`,
    });
  }
  if (routeraiEntries > 0 && routeraiWithUsd / routeraiEntries < 0.5) {
    warnings.push({
      severity: "warn",
      code: "routerai_low_priced",
      message: `only ${routeraiWithUsd}/${routeraiEntries} routerai entries have non-zero USD pricing (>50% free/unpriced)`,
    });
  }

  // 6. Arena entries with alpaca cross-reference — rough quality signal
  let arenaWithAlpaca = 0;
  for (const v of Object.values(input.arena)) {
    const e = v as { sources?: string[] };
    if (e.sources?.includes("alpaca_lc")) arenaWithAlpaca++;
  }

  // 7. Benchmark score sanity — only enforced if those sources were fetched
  const bs = input.benchmark_scores;
  const hleCount = bs ? Object.keys(bs.hle ?? {}).length : 0;
  const sweVCount = bs ? Object.keys(bs.swe_bench_verified ?? {}).length : 0;
  const sweLCount = bs ? Object.keys(bs.swe_bench_lite ?? {}).length : 0;
  const sweMCount = bs ? Object.keys(bs.swe_bench_multilingual ?? {}).length : 0;

  if (bs) {
    if (hleCount < MIN_HLE) {
      errors.push({
        severity: "error",
        code: "hle_underflow",
        message: `HLE has ${hleCount} entries, expected >= ${MIN_HLE}`,
      });
    }
    if (sweVCount < MIN_SWE_VERIFIED) {
      errors.push({
        severity: "error",
        code: "swe_verified_underflow",
        message: `SWE-bench Verified has ${sweVCount} entries, expected >= ${MIN_SWE_VERIFIED}`,
      });
    }
    if (sweLCount < MIN_SWE_LITE) {
      warnings.push({
        severity: "warn",
        code: "swe_lite_underflow",
        message: `SWE-bench Lite has ${sweLCount} entries, expected >= ${MIN_SWE_LITE}`,
      });
    }
    if (sweMCount < MIN_SWE_MULTILINGUAL) {
      warnings.push({
        severity: "warn",
        code: "swe_multilingual_underflow",
        message: `SWE-bench Multilingual has ${sweMCount} entries, expected >= ${MIN_SWE_MULTILINGUAL}`,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      arena_entries: arenaEntries,
      routerai_entries: routeraiEntries,
      arena_with_alpaca: arenaWithAlpaca,
      routerai_with_usd: routeraiWithUsd,
      duplicate_keys: duplicates,
      usd_rub: Number.isFinite(rate) ? rate : null,
      hle_entries: hleCount,
      swe_verified_entries: sweVCount,
      swe_lite_entries: sweLCount,
      swe_multilingual_entries: sweMCount,
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
  lines.push(`  arena entries:         ${r.stats.arena_entries}`);
  lines.push(`  arena w/ alpaca:       ${r.stats.arena_with_alpaca}`);
  lines.push(`  routerai models:       ${r.stats.routerai_entries}`);
  lines.push(`  routerai w/ USD:       ${r.stats.routerai_with_usd}`);
  lines.push(`  duplicate keys:        ${r.stats.duplicate_keys}`);
  lines.push(`  USD/RUB:               ${r.stats.usd_rub ?? "(none)"}`);
  lines.push(`  HLE scores:            ${r.stats.hle_entries}`);
  lines.push(`  SWE-bench Verified:    ${r.stats.swe_verified_entries}`);
  lines.push(`  SWE-bench Lite:        ${r.stats.swe_lite_entries}`);
  lines.push(`  SWE-bench Multiling:   ${r.stats.swe_multilingual_entries}`);
  return lines.join("\n");
}