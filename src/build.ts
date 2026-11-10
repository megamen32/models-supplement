/**
 * build.ts — Main entry point.
 *
 * Fetches all sources in parallel, merges them into a single supplement.json
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
 * Output schema (v2.0): model-centric.
 *   supplement.models["<vendor>/<model>"] = { arena?, alpaca_lc?, routerai?, hle?, swebench_pro?, ... }
 * Each model entry only contains sub-records for sources that include it.
 * Sources that use display names (HLE, SWE-bench) are mapped to canonical
 * vendor/name form via src/canonical.ts. Items that cannot be mapped are
 * surfaced in `unmatched_display_names` for review.
 *
 * Usage:
 *   bun src/build.ts              # build + write supplement.json
 *   bun src/build.ts --dry-run    # preview only, no file written
 *
 * Inspired by llm-inference-benchmark's manifest + sanity-check + diff-gate
 * pattern: every emitted artifact carries provenance (git, runtime, per-source
 * SHA-256, output SHA-256) so consumers can defend the numbers months later.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchAlpaca, fetchArena } from "./arena";
import { fetchRouterAI } from "./routerai";
import { fetchHLE, fetchSWEbench } from "./scores";
import { getEnvFingerprint, getGitInfo, sha256, type FetchStat } from "./provenance";
import { formatReport, runChecks } from "./checks";
import { fetchModelsDev, MODELS_DEV_URL } from "./upstream";
import { buildCodingBenchmarkManifest } from "./coding-benchmarks";
import { assemble } from "./assemble";
import { firstError, parsePrevious, type SourceState } from "./source";
import type { ModelEntry, Unmatched } from "./build-types";

interface Supplement {
  generated_at: string;
  schema_version: "3.0";
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
  } | null;
  models: Record<string, ModelEntry>;
  unmatched_display_names: Unmatched;
  /** One state per source: url + status ok|stale|absent (+ error, last_ok_at). */
  sources: Record<string, SourceState>;
}

const SOURCE_URLS: Record<string, string> = {
  upstream: MODELS_DEV_URL,
  arena: "https://api.wulong.dev/arena-ai-leaderboards/v1/leaderboard",
  alpaca_lc: "https://raw.githubusercontent.com/tatsu-lab/alpaca_eval/main/src/alpaca_eval/leaderboards/data_AlpacaEval_2/weighted_alpaca_eval_gpt4_turbo_leaderboard.csv",
  routerai: "https://routerai.ru/api/v1/models",
  hle: "https://dashboard.safe.ai/api/models",
  swe_bench_leaderboard: "https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json",
};

function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes("--dry-run") };
}

function printDryRunSummary(s: Supplement): void {
  const arenaEntries = Object.values(s.models).filter((m) => m.arena).length;
  const routeraiEntries = Object.values(s.models).filter((m) => m.routerai).length;
  const hleEntries = Object.values(s.models).filter((m) => m.hle).length;
  const sweVEntries = Object.values(s.models).filter((m) => m.swe_bench_verified).length;
  const sweLEntries = Object.values(s.models).filter((m) => m.swe_bench_lite).length;
  const sweMEntries = Object.values(s.models).filter((m) => m.swe_bench_multilingual).length;
  const swePEntries = Object.values(s.models).filter((m) => m.swebench_pro).length;
  const alpacaEntries = Object.values(s.models).filter((m) => m.alpaca_lc).length;
  const upstreamEntries = Object.values(s.models).filter((m) => m.models_dev).length;

  const topElo = Object.values(s.models)
    .filter((m) => m.arena && m.arena.elo > 0)
    .sort((a, b) => (b.arena!.elo - a.arena!.elo))
    .slice(0, 3);

  const topHLE = Object.values(s.models)
    .filter((m) => m.hle)
    .sort((a, b) => (b.hle!.raw_score - a.hle!.raw_score))
    .slice(0, 3);

  const topSWE = Object.values(s.models)
    .filter((m) => m.swe_bench_verified)
    .sort((a, b) => (b.swe_bench_verified!.raw_score - a.swe_bench_verified!.raw_score))
    .slice(0, 3);

  console.log("");
  console.log("=== dry-run summary ===");
  console.log(`  would write:        supplement.json`);
  console.log(`  schema_version:     ${s.schema_version}`);
  console.log(`  git commit:         ${s.provenance.git.commit ?? "(none)"}${s.provenance.git.dirty ? " (dirty)" : ""}`);
  console.log(`  bun:                ${s.provenance.env.bun_version}`);
  console.log(`  models:             ${Object.keys(s.models).length}`);
  console.log(`    with arena:       ${arenaEntries}`);
  console.log(`    with alpaca_lc:   ${alpacaEntries}`);
  console.log(`    with routerai:    ${routeraiEntries}`);
  console.log(`    with hle:         ${hleEntries}`);
  console.log(`    with swebench_pro:${swePEntries}`);
  console.log(`    with swe_verified:${sweVEntries}`);
  console.log(`    with swe_lite:    ${sweLEntries}`);
  console.log(`    with swe_multilin:${sweMEntries}`);
  console.log(`    with models.dev:  ${upstreamEntries}`);
  console.log(`  USD/RUB:            ${s.currency ? `${s.currency.usd_rub} (${s.currency.source})` : "(none)"}`);
  for (const [name, st] of Object.entries(s.sources)) {
    console.log(`  source ${name.padEnd(22)} ${st.status}${st.error ? `  (${st.error.slice(0, 80)})` : ""}`);
  }
  console.log(`  sources ok:         ${s.provenance.sources.filter((x) => x.ok).length}/${s.provenance.sources.length}`);
  const upstream = s.provenance.sources.find((x) => x.name === "models_dev");
  if (upstream?.fallback) console.log(`  models.dev:         fallback (${upstream.fallback_source})`);
  const totalUnmatched = Object.values(s.unmatched_display_names).reduce((s, a) => s + a.length, 0);
  console.log(`  unmatched:          ${totalUnmatched}`);

  if (topElo.length > 0) {
    console.log(`  top 3 arena ELO:`);
    for (const m of topElo) {
      console.log(`    ${m.arena!.elo.toString().padStart(5)}  ${m.canonical_id}  (score=${m.arena!.score})`);
    }
  }
  if (topHLE.length > 0) {
    console.log(`  top 3 HLE:`);
    for (const m of topHLE) {
      console.log(`    ${m.hle!.raw_score.toFixed(1).padStart(5)}%  ${m.canonical_id}`);
    }
  }
  if (topSWE.length > 0) {
    console.log(`  top 3 SWE-bench Verified:`);
    for (const m of topSWE) {
      console.log(`    ${m.swe_bench_verified!.raw_score.toFixed(1).padStart(5)}%  ${m.canonical_id}`);
    }
  }
  console.log(`  output sha256:      ${s.provenance.output_sha256.slice(0, 16)}...`);
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));

  console.log(`=== models-supplement build${dryRun ? " (DRY RUN)" : ""} ===\n`);

  const t0 = performance.now();
  const artifactPath = resolve(import.meta.dir, "..", "supplement.json");
  const codingManifestPath = resolve(import.meta.dir, "..", "coding-benchmarks.json");
  let prevText = "";
  try { prevText = readFileSync(artifactPath, "utf8"); } catch { /* first build */ }
  const prev = prevText ? parsePrevious(prevText) : null;

  const [upstreamResult, arenaResult, alpacaResult, routeraiResult, hleResult, sweResult] = await Promise.all([
    fetchModelsDev(artifactPath),
    fetchArena(),
    fetchAlpaca(),
    fetchRouterAI(),
    fetchHLE(),
    fetchSWEbench(),
  ]);
  const buildMs = Math.round(performance.now() - t0);

  const git = getGitInfo();
  const env = getEnvFingerprint();
  const generatedAt = new Date().toISOString();

  const sweStat = sweResult.stats[0];
  const { models, unmatched, states, currency } = assemble({
    now: generatedAt,
    prev,
    upstream: {
      models: upstreamResult.models,
      ok: upstreamResult.live,
      fallback: upstreamResult.stat.fallback === true,
      error: upstreamResult.stat.error,
    },
    arena: arenaResult,
    alpaca: alpacaResult,
    routerai: routeraiResult,
    hle: {
      ok: hleResult.stat.ok,
      records: { hle: hleResult.hle, swebench_pro: hleResult.swebench_pro },
      error: firstError([hleResult.stat]),
      stats: [hleResult.stat],
    },
    swe: {
      ok: sweStat.ok,
      records: {
        swe_bench_verified: sweResult.swe_bench_verified,
        swe_bench_lite: sweResult.swe_bench_lite,
        swe_bench_multilingual: sweResult.swe_bench_multilingual,
      },
      error: firstError([sweStat]),
      stats: sweResult.stats,
    },
    urls: SOURCE_URLS,
  });

  const fetchStats: FetchStat[] = [
    upstreamResult.stat,
    ...arenaResult.stats,
    ...alpacaResult.stats,
    ...routeraiResult.stats,
    hleResult.stat,
    ...sweResult.stats,
  ];

  const draft: Omit<Supplement, "provenance"> & {
    provenance: Omit<Supplement["provenance"], "output_sha256" | "dry_run">;
  } = {
    generated_at: generatedAt,
    schema_version: "3.0",
    provenance: { git, env, sources: fetchStats },
    currency,
    models,
    unmatched_display_names: unmatched,
    sources: states,
  };

  const report = runChecks({
    currency: draft.currency,
    sources: states,
    models: draft.models,
    unmatched: draft.unmatched_display_names,
    upstream: {
      model_count: Object.keys(upstreamResult.models).length,
      live: upstreamResult.live,
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

  const supplementBytes = JSON.stringify(supplement, null, 2);
  const codingManifest = buildCodingBenchmarkManifest(supplement, {
    sourceSha256: sha256(supplementBytes),
    generatedAt: supplement.generated_at,
  });
  // The manifest is machine-consumed and generated on every build; keep it
  // compact so it stays below repository file-size/line-count limits.
  const codingManifestBytes = JSON.stringify(codingManifest);
  writeFileSync(artifactPath, supplementBytes);
  writeFileSync(codingManifestPath, codingManifestBytes);
  console.log(`\n=== Done in ${buildMs}ms: ${artifactPath} ===`);
  console.log(`  total models:        ${Object.keys(supplement.models).length}`);
  console.log(`  coding manifest:     ${codingManifestPath} (${Object.keys(codingManifest.models).length} models)`);
  console.log(`  USD/RUB:             ${supplement.currency?.usd_rub ?? "(none)"}`);
  console.log(`  output sha256:       ${supplement.provenance.output_sha256.slice(0, 16)}...`);
  const totalUnmatched = Object.values(supplement.unmatched_display_names).reduce((s, a) => s + a.length, 0);
  if (totalUnmatched > 0) console.log(`  unmatched:           ${totalUnmatched} (see unmatched_display_names)`);
}

main().catch((err) => {
  console.error("[build] failed:", err);
  process.exit(1);
});
