/**
 * build.ts — Main entry point.
 *
 * Fetches all sources in parallel, merges into a single supplement.json
 * consumed by AutoTelegramViews and TG_Commentator alongside the upstream
 * models.dev/api.json.
 *
 * Sources:
 *   - Arena AI leaderboard (ELO + AlpacaEval LC)
 *   - RouterAI (300+ Russian LLM models with RUB pricing)
 *   - HLE (Humanity's Last Exam) + SWE-bench Pro (CAIS Dashboard)
 *   - SWE-bench Verified + Lite + Multilingual (official leaderboard JSON)
 *   - CBR USD/RUB rate
 *
 * Usage:
 *   bun src/build.ts              # build + write supplement.json
 *   bun src/build.ts --dry-run    # preview only, no file written
 *
 * Output: supplement.json  (deploy to GitHub Pages)
 *
 * Inspired by llm-inference-benchmark's manifest + sanity-check + diff-gate
 * pattern: every emitted artifact carries provenance (git, runtime, per-source
 * SHA-256, output SHA-256) so consumers can defend the numbers months later.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildArenaSupplement } from "./arena";
import { buildRouterAISupplement } from "./routerai";
import { fetchHLE, fetchSWEbench, type ScoreEntry } from "./scores";
import { getEnvFingerprint, getGitInfo, sha256, type FetchStat } from "./provenance";
import { formatReport, runChecks } from "./checks";

interface Supplement {
  generated_at: string;
  schema_version: string;
  provenance: {
    git: { commit: string | null; dirty: boolean; branch: string | null };
    env: ReturnType<typeof getEnvFingerprint>;
    sources: FetchStat[];
    output_sha256: string;
    dry_run: boolean;
  };
  currency: {
    usd_rub: number;
    source: string;
    fetched_at: string;
  };
  arena: Record<string, unknown>;
  arena_meta: Record<string, unknown>;
  routerai: Record<string, unknown>;
  routerai_meta: Record<string, unknown>;
  benchmark_scores: {
    hle: Record<string, ScoreEntry>;
    swebench_pro: Record<string, ScoreEntry>;
    swe_bench_verified: Record<string, ScoreEntry>;
    swe_bench_lite: Record<string, ScoreEntry>;
    swe_bench_multilingual: Record<string, ScoreEntry>;
    _meta: Record<string, unknown>;
  };
  sources: {
    upstream: string;
    arena: string;
    routerai: string;
    hle: string;
    swe_bench_leaderboard: string;
  };
}

function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes("--dry-run") };
}

function printDryRunSummary(s: Supplement): void {
  const arenaEntries = Object.entries(s.arena) as [string, { elo: number; score: number; sources: string[] }][];
  const topElo = arenaEntries
    .filter(([, e]) => e.elo > 0)
    .sort((a, b) => b[1].elo - a[1].elo)
    .slice(0, 3);

  const bs = s.benchmark_scores;
  console.log("");
  console.log("=== dry-run summary ===");
  console.log(`  would write:        supplement.json`);
  console.log(`  schema_version:     ${s.schema_version}`);
  console.log(`  git commit:         ${s.provenance.git.commit ?? "(none)"}${s.provenance.git.dirty ? " (dirty)" : ""}`);
  console.log(`  bun:                ${s.provenance.env.bun_version}`);
  console.log(`  arena entries:      ${Object.keys(s.arena).length}`);
  console.log(`  routerai models:    ${Object.keys(s.routerai).length}`);
  console.log(`  USD/RUB:            ${s.currency.usd_rub} (${s.currency.source})`);
  console.log(`  HLE scores:         ${Object.keys(bs.hle).length}`);
  console.log(`  SWE-bench Pro:      ${Object.keys(bs.swebench_pro).length}`);
  console.log(`  SWE-bench Verified: ${Object.keys(bs.swe_bench_verified).length}`);
  console.log(`  SWE-bench Lite:     ${Object.keys(bs.swe_bench_lite).length}`);
  console.log(`  SWE-bench Multi:    ${Object.keys(bs.swe_bench_multilingual).length}`);
  console.log(`  sources ok:         ${s.provenance.sources.filter((x) => x.ok).length}/${s.provenance.sources.length}`);
  console.log(`  top 3 arena ELO:`);
  for (const [name, e] of topElo) {
    console.log(`    ${e.elo.toString().padStart(5)}  ${name}  (score=${e.score}, sources=${e.sources.join("+")})`);
  }
  // Top 3 HLE
  const topHLE = Object.entries(bs.hle)
    .sort((a, b) => b[1].raw_score - a[1].raw_score)
    .slice(0, 3);
  if (topHLE.length > 0) {
    console.log(`  top 3 HLE:`);
    for (const [k, v] of topHLE) {
      console.log(`    ${v.raw_score.toFixed(1).padStart(5)}%  ${k}  (raw: ${v.raw_name})`);
    }
  }
  console.log(`  output sha256:      ${s.provenance.output_sha256.slice(0, 16)}...`);
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));

  console.log(`=== models-supplement build${dryRun ? " (DRY RUN)" : ""} ===\n`);

  const t0 = performance.now();
  const [arenaResult, routeraiResult, hleResult, sweResult] = await Promise.all([
    buildArenaSupplement(),
    buildRouterAISupplement(),
    fetchHLE(),
    fetchSWEbench(),
  ]);
  const buildMs = Math.round(performance.now() - t0);

  const git = getGitInfo();
  const env = getEnvFingerprint();

  const benchmarkMeta = {
    hle: {
      count: Object.keys(hleResult.hle).length,
      stat: hleResult.stat,
    },
    swebench_pro: {
      count: Object.keys(hleResult.swebench_pro).length,
    },
    swe_bench_verified: {
      count: Object.keys(sweResult.swe_bench_verified).length,
    },
    swe_bench_lite: {
      count: Object.keys(sweResult.swe_bench_lite).length,
    },
    swe_bench_multilingual: {
      count: Object.keys(sweResult.swe_bench_multilingual).length,
    },
    fetched_at: new Date().toISOString(),
  };

  const fetchStats: FetchStat[] = [
    ...arenaResult.fetch_stats,
    ...routeraiResult.fetch_stats,
    hleResult.stat,
    ...sweResult.stats,
  ];

  const draft: Omit<Supplement, "provenance"> & {
    provenance: Omit<Supplement["provenance"], "output_sha256" | "dry_run">;
  } = {
    generated_at: new Date().toISOString(),
    schema_version: "1.1",
    provenance: { git, env, sources: fetchStats },
    currency: routeraiResult.currency,
    arena: arenaResult.arena,
    arena_meta: arenaResult.meta,
    routerai: routeraiResult.models,
    routerai_meta: routeraiResult.meta,
    benchmark_scores: {
      hle: hleResult.hle,
      swebench_pro: hleResult.swebench_pro,
      swe_bench_verified: sweResult.swe_bench_verified,
      swe_bench_lite: sweResult.swe_bench_lite,
      swe_bench_multilingual: sweResult.swe_bench_multilingual,
      _meta: benchmarkMeta,
    },
    sources: {
      upstream: "https://models.dev/api.json",
      arena: "https://api.wulong.dev/arena-ai-leaderboards/v1/leaderboard",
      routerai: "https://routerai.ru/api/v1/models",
      hle: "https://dashboard.safe.ai/api/models",
      swe_bench_leaderboard: "https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json",
    },
  };

  const report = runChecks({
    arena: draft.arena,
    routerai: draft.routerai,
    currency: draft.currency,
    benchmark_scores: {
      hle: draft.benchmark_scores.hle,
      swe_bench_verified: draft.benchmark_scores.swe_bench_verified,
      swe_bench_lite: draft.benchmark_scores.swe_bench_lite,
      swe_bench_multilingual: draft.benchmark_scores.swe_bench_multilingual,
    },
  });
  console.log("");
  console.log(formatReport(report));

  const serialized = JSON.stringify(draft, null, 2);
  const outputHash = sha256(serialized);

  const supplement: Supplement = {
    ...draft,
    provenance: {
      ...draft.provenance,
      output_sha256: outputHash,
      dry_run: dryRun,
    },
  };

  if (dryRun) {
    printDryRunSummary(supplement);
    console.log(`\n=== dry-run done in ${buildMs}ms (no file written) ===`);
    if (!report.ok) {
      console.error("[build] dry-run completed with errors — fix before real build");
      process.exit(1);
    }
    return;
  }

  if (!report.ok) {
    console.error("[build] sanity checks failed — refusing to write supplement.json");
    process.exit(1);
  }

  const outPath = resolve(import.meta.dir, "..", "supplement.json");
  writeFileSync(outPath, JSON.stringify(supplement, null, 2));
  console.log(`\n=== Done in ${buildMs}ms: ${outPath} ===`);
  console.log(`  Arena entries:       ${Object.keys(supplement.arena).length}`);
  console.log(`  RouterAI models:     ${Object.keys(supplement.routerai).length}`);
  console.log(`  HLE scores:          ${Object.keys(supplement.benchmark_scores.hle).length}`);
  console.log(`  SWE-bench Pro:       ${Object.keys(supplement.benchmark_scores.swebench_pro).length}`);
  console.log(`  SWE-bench Verified:  ${Object.keys(supplement.benchmark_scores.swe_bench_verified).length}`);
  console.log(`  SWE-bench Lite:      ${Object.keys(supplement.benchmark_scores.swe_bench_lite).length}`);
  console.log(`  SWE-bench Multiling: ${Object.keys(supplement.benchmark_scores.swe_bench_multilingual).length}`);
  console.log(`  USD/RUB:             ${supplement.currency.usd_rub}`);
  console.log(`  output sha256:       ${supplement.provenance.output_sha256.slice(0, 16)}...`);
}

main().catch((err) => {
  console.error("[build] failed:", err);
  process.exit(1);
});