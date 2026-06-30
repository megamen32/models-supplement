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

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildArenaSupplement, type ArenaEntry } from "./arena";
import { buildRouterAISupplement, type RouterAIModelEntry } from "./routerai";
import { fetchHLE, fetchSWEbench, type ScoreEntry } from "./scores";
import { getEnvFingerprint, getGitInfo, sha256, type FetchStat } from "./provenance";
import { formatReport, runChecks } from "./checks";
import {
  arenaKeyToCanonical,
  displayNameFromRaw,
  hleToCanonical,
  routeraiKeyToCanonical,
  sweKeyToCanonical,
} from "./canonical";
import type { ModelEntry, Unmatched } from "./build-types";

interface Supplement {
  generated_at: string;
  schema_version: "2.0";
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
  models: Record<string, ModelEntry>;
  unmatched_display_names: Unmatched;
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

function ensureModel(
  models: Record<string, ModelEntry>,
  canonicalId: string,
  vendor: string,
  displayName?: string,
): ModelEntry {
  let m = models[canonicalId];
  if (!m) {
    m = {
      canonical_id: canonicalId,
      vendor,
      benchmark_sources: [],
    };
    models[canonicalId] = m;
  }
  if (displayName && !m.display_name) m.display_name = displayName;
  return m;
}

function addSource(m: ModelEntry, source: string): void {
  if (!m.benchmark_sources.includes(source)) m.benchmark_sources.push(source);
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
  console.log(`  USD/RUB:            ${s.currency.usd_rub} (${s.currency.source})`);
  console.log(`  sources ok:         ${s.provenance.sources.filter((x) => x.ok).length}/${s.provenance.sources.length}`);
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
  const [arenaResult, routeraiResult, hleResult, sweResult] = await Promise.all([
    buildArenaSupplement(),
    buildRouterAISupplement(),
    fetchHLE(),
    fetchSWEbench(),
  ]);
  const buildMs = Math.round(performance.now() - t0);

  const git = getGitInfo();
  const env = getEnvFingerprint();

  const models: Record<string, ModelEntry> = {};
  const unmatched: Unmatched = {
    hle: [], swebench_pro: [], swe_bench_verified: [], swe_bench_lite: [], swe_bench_multilingual: [],
  };

  // 1. arena + alpaca_lc (merged via arena.ts)
  for (const [arenaKey, entry] of Object.entries(arenaResult.arena) as [string, ArenaEntry][]) {
    const vendor = entry.vendor || (arenaKey.includes("/") ? arenaKey.split("/")[0] : "");
    const cid = arenaKeyToCanonical(arenaKey, vendor || "unknown");
    const displayName = displayNameFromRaw(arenaKey);
    const m = ensureModel(models, cid, cid.split("/")[0], displayName);
    m.arena = {
      elo: entry.elo,
      score: entry.score,
      rank: entry.rank,
      leaderboard: entry.leaderboard,
      ci: entry.ci,
      votes: entry.votes,
      confidence: entry.confidence,
      license: entry.license,
      sources: entry.sources,
      last_updated: entry.lastUpdated,
      fetched_at: entry.fetchedAt,
    };
    addSource(m, "arena");
    if (entry.alpaca_lc) {
      m.alpaca_lc = entry.alpaca_lc;
      addSource(m, "alpaca_lc");
    }
  }

  // 2. routerai
  for (const [key, entry] of Object.entries(routeraiResult.models) as [string, RouterAIModelEntry][]) {
    const cid = routeraiKeyToCanonical(key);
    const m = ensureModel(models, cid, cid.split("/")[0], entry.name);
    m.routerai = entry;
    addSource(m, "routerai");
  }

  // 3. HLE
  for (const [normKey, entry] of Object.entries(hleResult.hle) as [string, ScoreEntry][]) {
    const provider = (entry.extras?.provider as string) ?? undefined;
    const cid = hleToCanonical(normKey, provider);
    if (!cid) {
      unmatched.hle.push({ display_name: entry.raw_name, reason: "unknown_vendor" });
      continue;
    }
    const m = ensureModel(models, cid, cid.split("/")[0], displayNameFromRaw(entry.raw_name));
    m.hle = {
      score: entry.score,
      raw_score: entry.raw_score,
      date: entry.date,
      calibration_error: (entry.extras?.calibration_error as number | null) ?? null,
      provider,
    };
    addSource(m, "hle");
  }

  // 4. SWE-bench Pro (from HLE API)
  for (const [normKey, entry] of Object.entries(hleResult.swebench_pro) as [string, ScoreEntry][]) {
    const provider = (entry.extras?.provider as string) ?? undefined;
    const cid = hleToCanonical(normKey, provider);
    if (!cid) {
      unmatched.swebench_pro.push({ display_name: entry.raw_name, reason: "unknown_vendor" });
      continue;
    }
    const m = ensureModel(models, cid, cid.split("/")[0], displayNameFromRaw(entry.raw_name));
    m.swebench_pro = { score: entry.score, raw_score: entry.raw_score, date: entry.date };
    addSource(m, "swebench_pro");
  }

  // 5. SWE-bench Verified + Lite + Multilingual
  for (const split of ["swe_bench_verified", "swe_bench_lite", "swe_bench_multilingual"] as const) {
    for (const [normKey, entry] of Object.entries(sweResult[split]) as [string, ScoreEntry][]) {
      const cid = sweKeyToCanonical(normKey);
      if (!cid) {
        unmatched[split].push({ display_name: entry.raw_name, reason: "unknown_vendor" });
        continue;
      }
      const m = ensureModel(models, cid, cid.split("/")[0], displayNameFromRaw(entry.raw_name));
      m[split] = { score: entry.score, raw_score: entry.raw_score, date: entry.date };
      addSource(m, split);
    }
  }

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
    schema_version: "2.0",
    provenance: { git, env, sources: fetchStats },
    currency: routeraiResult.currency,
    models,
    unmatched_display_names: unmatched,
    sources: {
      upstream: "https://models.dev/api.json",
      arena: "https://api.wulong.dev/arena-ai-leaderboards/v1/leaderboard",
      routerai: "https://routerai.ru/api/v1/models",
      hle: "https://dashboard.safe.ai/api/models",
      swe_bench_leaderboard: "https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json",
    },
  };

  const report = runChecks({
    arena: arenaResult.arena,
    routerai: routeraiResult.models,
    currency: draft.currency,
    models: draft.models,
    unmatched: draft.unmatched_display_names,
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
  console.log(`  total models:        ${Object.keys(supplement.models).length}`);
  console.log(`  USD/RUB:             ${supplement.currency.usd_rub}`);
  console.log(`  output sha256:       ${supplement.provenance.output_sha256.slice(0, 16)}...`);
  const totalUnmatched = Object.values(supplement.unmatched_display_names).reduce((s, a) => s + a.length, 0);
  if (totalUnmatched > 0) console.log(`  unmatched:           ${totalUnmatched} (see unmatched_display_names)`);
}

main().catch((err) => {
  console.error("[build] failed:", err);
  process.exit(1);
});