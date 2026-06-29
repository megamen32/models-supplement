/**
 * build.ts — Main entry point.
 *
 * Fetches arena ELO + AlpacaEval scores, RouterAI models with RUB pricing,
 * and CBR currency rates. Merges them into a single supplement.json that
 * both AutoTelegramViews and TG_Commentator consume alongside the real
 * upstream models.dev/api.json.
 *
 * Usage:  bun src/build.ts
 * Output: supplement.json  (deploy to GitHub Pages)
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildArenaSupplement } from "./arena";
import { buildRouterAISupplement } from "./routerai";

interface Supplement {
  generated_at: string;
  schema_version: string;
  currency: {
    usd_rub: number;
    source: string;
    fetched_at: string;
  };
  arena: Record<string, unknown>;
  arena_meta: Record<string, unknown>;
  routerai: Record<string, unknown>;
  routerai_meta: Record<string, unknown>;
  sources: {
    upstream: string;
    arena: string;
    routerai: string;
  };
}

async function main() {
  console.log("=== models-supplement build ===\n");

  const [arenaResult, routeraiResult] = await Promise.all([
    buildArenaSupplement(),
    buildRouterAISupplement(),
  ]);

  const supplement: Supplement = {
    generated_at: new Date().toISOString(),
    schema_version: "1.0",
    currency: routeraiResult.currency,
    arena: arenaResult.arena,
    arena_meta: arenaResult.meta,
    routerai: routeraiResult.models,
    routerai_meta: routeraiResult.meta,
    sources: {
      upstream: "https://models.dev/api.json",
      arena: "https://api.wulong.dev/arena-ai-leaderboards/v1/leaderboard",
      routerai: "https://routerai.ru/api/v1/models",
    },
  };

  const outPath = resolve(import.meta.dir, "..", "supplement.json");
  writeFileSync(outPath, JSON.stringify(supplement, null, 2));
  console.log(`\n=== Done: ${outPath} ===`);
  console.log(`  Arena entries:    ${Object.keys(supplement.arena).length}`);
  console.log(`  RouterAI models:  ${Object.keys(supplement.routerai).length}`);
  console.log(`  USD/RUB:          ${supplement.currency.usd_rub}`);
}

main().catch((err) => {
  console.error("[build] failed:", err);
  process.exit(1);
});
