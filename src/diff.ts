/**
 * diff.ts — CI regression gate for supplement.json.
 *
 * Compares a previous build against the current one and fails the workflow
 * if any per-source count drops more than `--threshold` percent. Mirrors the
 * `llm-bench diff --fail-on-regression N` pattern from the benchmark article.
 *
 * Tracks both the legacy source-centric metrics (arena/routerai entries) and
 * the new v2.0 model-centric metrics (models with each benchmark).
 *
 * Usage:
 *   bun src/diff.ts <previous.json> <current.json> [thresholdPct]
 *
 * Exit codes:
 *   0 — within threshold (or no previous to compare)
 *   1 — regression exceeds threshold
 *   2 — bad arguments
 */

import { readFileSync, existsSync } from "node:fs";

interface Counter {
  models_total: number;
  models_with_arena: number;
  models_with_routerai: number;
  models_with_hle: number;
  models_with_swe_verified: number;
  models_with_swe_lite: number;
  models_with_swe_multilingual: number;
  models_with_swebench_pro: number;
  usd_rub: number | null;
}

function counts(doc: unknown): Counter {
  const d = doc as {
    models?: Record<string, {
      arena?: unknown;
      routerai?: unknown;
      hle?: unknown;
      swebench_pro?: unknown;
      swe_bench_verified?: unknown;
      swe_bench_lite?: unknown;
      swe_bench_multilingual?: unknown;
    }>;
    currency?: { usd_rub?: number };
  };
  const models = Object.values(d.models ?? {});
  return {
    models_total: models.length,
    models_with_arena: models.filter((m) => m.arena).length,
    models_with_routerai: models.filter((m) => m.routerai).length,
    models_with_hle: models.filter((m) => m.hle).length,
    models_with_swe_verified: models.filter((m) => m.swe_bench_verified).length,
    models_with_swe_lite: models.filter((m) => m.swe_bench_lite).length,
    models_with_swe_multilingual: models.filter((m) => m.swe_bench_multilingual).length,
    models_with_swebench_pro: models.filter((m) => m.swebench_pro).length,
    usd_rub: typeof d.currency?.usd_rub === "number" ? d.currency.usd_rub : null,
  };
}

function pctDelta(prev: number, next: number): number {
  if (prev <= 0) return 0;
  return ((prev - next) / prev) * 100;
}

function row(label: string, prev: number, curr: number): { line: string; drop: number } {
  const drop = pctDelta(prev, curr);
  const arrow = drop >= 0 ? "−" : "+";
  return {
    line: `  ${label.padEnd(22)} ${prev.toString().padStart(5)} → ${curr.toString().padStart(5)}  (${arrow}${Math.abs(drop).toFixed(1)}%)`,
    drop,
  };
}

function main(): void {
  const [, , prevPath, currPath, thresholdStr] = process.argv;
  const threshold = Number(thresholdStr ?? "30");

  if (!prevPath || !currPath) {
    console.error("usage: bun src/diff.ts <previous.json> <current.json> [thresholdPct]");
    process.exit(2);
  }

  if (!existsSync(prevPath)) {
    console.log(`=== regression diff ===`);
    console.log(`  no previous build at ${prevPath} — skipping gate`);
    process.exit(0);
  }

  const prev = counts(JSON.parse(readFileSync(prevPath, "utf8")));
  const curr = counts(JSON.parse(readFileSync(currPath, "utf8")));

  const rows = [
    row("models_total", prev.models_total, curr.models_total),
    row("models_with_arena", prev.models_with_arena, curr.models_with_arena),
    row("models_with_routerai", prev.models_with_routerai, curr.models_with_routerai),
    row("models_with_hle", prev.models_with_hle, curr.models_with_hle),
    row("models_with_swe_v", prev.models_with_swe_verified, curr.models_with_swe_verified),
    row("models_with_swe_l", prev.models_with_swe_lite, curr.models_with_swe_lite),
    row("models_with_swe_m", prev.models_with_swe_multilingual, curr.models_with_swe_multilingual),
    row("models_with_swe_pro", prev.models_with_swebench_pro, curr.models_with_swebench_pro),
  ];

  console.log("=== regression diff ===");
  for (const r of rows) console.log(r.line);
  console.log(`  ${"usd_rub".padEnd(22)} ${String(prev.usd_rub).padStart(5)} → ${String(curr.usd_rub).padStart(5)}`);
  console.log(`  ${"threshold".padEnd(22)} ${threshold}%`);

  const failures: string[] = [];
  const labels = ["models_total", "models_with_arena", "models_with_routerai", "models_with_hle", "models_with_swe_v", "models_with_swe_l", "models_with_swe_m", "models_with_swe_pro"];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].drop > threshold) {
      failures.push(`${labels[i]} dropped ${rows[i].drop.toFixed(1)}% (>${threshold}%)`);
    }
  }

  if (failures.length > 0) {
    console.error("");
    console.error("FAIL: regression exceeded threshold:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("  ok: within threshold");
}

main();