/**
 * diff.ts — CI regression gate for supplement.json.
 *
 * Compares a previous build against the current one and fails the workflow
 * if any count drops more than `--threshold` percent. Mirrors the
 * `llm-bench diff --fail-on-regression N` pattern from the benchmark article.
 *
 * Usage:
 *   bun src/diff.ts <previous.json> <current.json> [thresholdPct]
 *
 * Exit codes:
 *   0 — within threshold (or no previous to compare)
 *   1 — regression exceeds threshold
 */

import { readFileSync, existsSync } from "node:fs";

interface Counter {
  arena: number;
  routerai: number;
  hle: number;
  swe_verified: number;
  swe_lite: number;
  swe_multilingual: number;
  usd_rub: number | null;
}

function counts(doc: unknown): Counter {
  const d = doc as {
    arena?: Record<string, unknown>;
    routerai?: Record<string, unknown>;
    benchmark_scores?: {
      hle?: Record<string, unknown>;
      swe_bench_verified?: Record<string, unknown>;
      swe_bench_lite?: Record<string, unknown>;
      swe_bench_multilingual?: Record<string, unknown>;
    };
    currency?: { usd_rub?: number };
  };
  return {
    arena: Object.keys(d.arena ?? {}).length,
    routerai: Object.keys(d.routerai ?? {}).length,
    hle: Object.keys(d.benchmark_scores?.hle ?? {}).length,
    swe_verified: Object.keys(d.benchmark_scores?.swe_bench_verified ?? {}).length,
    swe_lite: Object.keys(d.benchmark_scores?.swe_bench_lite ?? {}).length,
    swe_multilingual: Object.keys(d.benchmark_scores?.swe_bench_multilingual ?? {}).length,
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
    line: `  ${label.padEnd(20)} ${prev.toString().padStart(5)} → ${curr.toString().padStart(5)}  (${arrow}${Math.abs(drop).toFixed(1)}%)`,
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
    row("arena", prev.arena, curr.arena),
    row("routerai", prev.routerai, curr.routerai),
    row("hle", prev.hle, curr.hle),
    row("swe_verified", prev.swe_verified, curr.swe_verified),
    row("swe_lite", prev.swe_lite, curr.swe_lite),
    row("swe_multilingual", prev.swe_multilingual, curr.swe_multilingual),
  ];

  console.log("=== regression diff ===");
  for (const r of rows) console.log(r.line);
  console.log(`  ${"usd_rub".padEnd(20)} ${String(prev.usd_rub).padStart(5)} → ${String(curr.usd_rub).padStart(5)}`);
  console.log(`  ${"threshold".padEnd(20)} ${threshold}%`);

  const failures: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const labels = ["arena", "routerai", "hle", "swe_verified", "swe_lite", "swe_multilingual"];
    if (r.drop > threshold) {
      failures.push(`${labels[i]} dropped ${r.drop.toFixed(1)}% (>${threshold}%)`);
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