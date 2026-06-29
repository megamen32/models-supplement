# models-supplement

Lightweight supplement layer for [models.dev](https://models.dev). Not a fork — just an add-on.

## What it does

Fetches seven data sources and merges them into a single `supplement.json`:

| Source | What | Why it's not in upstream |
|--------|------|--------------------------|
| Arena AI leaderboard | ELO + quality scores | Upstream doesn't track arena |
| AlpacaEval 2.0 LC | Length-controlled winrate | Upstream doesn't track alpaca |
| RouterAI (routerai.ru) | 300+ LLM models with RUB pricing | Russian provider, not in upstream |
| HLE (Humanity's Last Exam) | Frontier expert-level benchmark (CAIS) | Hard-to-find in upstream |
| SWE-bench Pro | Code-agent benchmark from CAIS Dashboard | Held out from upstream |
| SWE-bench Verified | 500 human-validated GitHub-issue tasks | Not in upstream |
| SWE-bench Lite | 300 curated coding tasks | Not in upstream |
| SWE-bench Multilingual | 300 i18n coding tasks | Not in upstream |

## Architecture

```
Consumer (AutoTelegramViews / TG_Commentator)
  ├── models.dev/api.json     ← upstream (BASE: KC, tool_call, structured_output)
  └── supplement.json         ← this project (ADD: arena ELO, RUB pricing, benchmark scores)
```

Upstream is always fresh. Supplement only adds what upstream doesn't have.

## Output schema

```ts
{
  generated_at: string,            // ISO 8601
  schema_version: "1.1",
  provenance: { git, env, sources: FetchStat[], output_sha256, dry_run },
  currency: { usd_rub, source, fetched_at },
  arena: { [normalizedModelName]: ArenaEntry },
  routerai: { [modelId]: RouterAIModelEntry },
  benchmark_scores: {
    hle:                   { [k]: ScoreEntry },  // 44 models
    swebench_pro:          { [k]: ScoreEntry },  // 40 models
    swe_bench_verified:    { [k]: ScoreEntry },  // 150 models
    swe_bench_lite:        { [k]: ScoreEntry },  // 77 models
    swe_bench_multilingual:{ [k]: ScoreEntry },  // 13 models
    _meta: { ... per-source counts + fetch stats },
  },
  sources: { upstream, arena, routerai, hle, swe_bench_leaderboard },
}
```

`ScoreEntry`:
```ts
{
  raw_name: string,           // original name from source (debugging)
  score: number,              // 0..1 normalized
  raw_score: number,          // original percentage (e.g., 38.4)
  date?: string,              // YYYY-MM-DD when available
  sources: string[],          // ["hle"], ["swe_bench_verified"], ...
  extras?: { calibration_error?, model_id?, provider? }, // HLE only
}
```

## Model-name normalization

Sources use different conventions for the same model:
- arena:    `"anthropic/claude-opus-4-6-thinking"`
- HLE:      `"Opus 4.6"` (no vendor prefix)
- SWE-bench: `"live-SWE-agent + Claude 4.5 Opus medium (20251101)"`

`src/normalize.ts` produces a stable key:
- Strips vendor prefixes, scaffolding agents (`live-SWE-agent +`, `mini-SWE-agent +`, `swe-agent +`, `sweagent +`), parenthesized annotations `(2025-08-22)`, ISO dates, and lowercases everything
- Keeps model-identity suffixes (`-thinking`, `-preview`, `-codex`)

For family-level grouping (collapse variants), use `familyKey()` from the same module.

## Build

```bash
bun install
bun src/build.ts              # build + write supplement.json
bun src/build.ts --dry-run    # preview only, no file written
```

Output: `supplement.json` (~440 KB compressed, ~3 MB pretty-printed)

## Reliability features

Mirrors the manifest + sanity-check + diff-gate pattern from `llm-inference-benchmark` (Happynood, 2025).

- **`provenance` block in output** — git commit/branch/dirty, bun/node version, per-source URL+bytes+SHA-256+duration, final artifact SHA-256. Lets consumers defend every number months later.
- **Sanity checks** — built into `src/build.ts`. Fails the build if any source drops below threshold (arena<50, routerai<50, HLE<5, SWE-bench Verified<20), USD/RUB rate is invalid/out-of-range, or schema drift. Warnings for key collisions and SWE-bench Lite/Multilingual underflow.
- **CI regression gate** — `.github/workflows/build.yml` runs `bun src/diff.ts` between `HEAD:supplement.json` and the new build; fails if any source dropped >30% overnight.

```bash
# CI gate manually:
git show HEAD:supplement.json > /tmp/prev.json
bun src/diff.ts /tmp/prev.json supplement.json 30
```

## Deploy

GitHub Actions builds daily at 06:00 UTC and deploys to GitHub Pages.

Consumers fetch: `https://<user>.github.io/models-supplement/supplement.json`

## Files

```
src/
├── build.ts        # Main: merge all sources → supplement.json (runs checks, writes provenance)
├── arena.ts        # Arena AI + AlpacaEval scores
├── routerai.ts     # RouterAI models with RUB pricing
├── currency.ts     # CBR USD/RUB rates
├── scores.ts       # HLE + SWE-bench (Verified/Lite/Multilingual) + SWE-bench Pro
├── normalize.ts    # Shared model-name normalization across all sources
├── provenance.ts   # git info, env fingerprint, SHA-256 helpers
├── checks.ts       # post-merge sanity checks (errors + warnings)
└── diff.ts         # CI regression gate between two supplement.json files
```
