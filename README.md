# models-supplement

Lightweight supplement layer for [models.dev](https://models.dev). Not a fork — just an add-on.

## What it does

Fetches seven data sources and merges them into a single `supplement.json` keyed by **canonical model id** (vendor/name, same shape as models.dev):

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

Upstream is always fresh. Supplement only adds what upstream doesn't have. **Same model_id → same key as models.dev**, so consumers can do `supplement.models["<vendor>/<model>"]` and get all extra facts at once.

## Output schema (v2.0, model-centric)

```ts
{
  generated_at: string,
  schema_version: "2.0",
  provenance: { git, env, sources: FetchStat[], output_sha256, dry_run },
  currency: { usd_rub, source, fetched_at },
  models: {
    "<vendor>/<model>": {
      canonical_id: "anthropic/claude-opus-4-6",
      vendor: "anthropic",
      display_name: "Claude Opus 4.6",
      arena?:       { elo, score, rank, leaderboard, ci, votes, confidence, license, sources, last_updated, fetched_at },
      alpaca_lc?:   { winrate, lc_winrate, n },
      routerai?:    { id, name, description, context_length, input_rub_per_token, output_rub_per_token,
                       input_usd_per_1m, output_usd_per_1m, supports_vision, supports_tools,
                       supports_structured_output, reasoning },
      hle?:         { score, raw_score, date, calibration_error, provider },
      swebench_pro?:          { score, raw_score, date },
      swe_bench_verified?:    { score, raw_score, date },
      swe_bench_lite?:        { score, raw_score, date },
      swe_bench_multilingual?:{ score, raw_score, date },
      benchmark_sources: string[],   // which sub-records are present
    }
  },
  unmatched_display_names: { hle, swebench_pro, swe_bench_verified, swe_bench_lite, swe_bench_multilingual },
  sources: { upstream, arena, routerai, hle, swe_bench_leaderboard },
}
```

Each `models[]` entry only has sub-records for sources that contain the model. `unmatched_display_names` surfaces HLE/SWE-bench entries whose vendor couldn't be inferred (typically agent systems like TRAE, Bloop, Warp — not models).

## Canonical-id mapping

`src/canonical.ts` resolves three different naming styles to the same `vendor/name` form:

| Source | Raw name | → Canonical |
|--------|----------|-------------|
| arena | `claude-opus-4-6` (vendor="Anthropic") | `anthropic/claude-opus-4-6` |
| arena | `glm-5.2 (max)` (vendor="Z.AI") | `z-ai/glm-5.2 (max)` |
| HLE | `Opus 4.6` (provider="anthropic") | `anthropic/claude-opus-4-6` |
| HLE | `GPT-5.5` (provider="openai") | `openai/gpt-5-5` |
| SWE-bench | `live-SWE-agent + Claude 4.5 Opus medium (20251101)` | `anthropic/claude-4-5-opus-medium` |
| SWE-bench | `Bloop` | *(unmatched — agent system, not a model)* |
| routerai | `qwen/qwen3-next-80b-a3b-thinking` | `qwen/qwen3-next-80b-a3b-thinking` (passthrough) |

Rules (`canonical.ts`):
1. **HLE**: trust the API's `provider` field; canonicalize Anthropic names so "Opus" → "claude-opus".
2. **SWE-bench**: no vendor field → infer from family prefix (claude/gpt/gemini/grok/etc). Unknown families go to `unmatched_display_names`.
3. **arena**: arena entries have `vendor` field; the key itself is vendor-stripped.
4. **routerai**: keys are already `vendor/name`; split on first `/`.

## Build

```bash
bun install
bun src/build.ts              # build + write supplement.json
bun src/build.ts --dry-run    # preview only, no file written
```

Output: `supplement.json` (~480 KB pretty-printed, 651 model entries)

## Reliability features

Mirrors the manifest + sanity-check + diff-gate pattern from `llm-inference-benchmark` (Happynood, 2025).

- **`provenance` block in output** — git commit/branch/dirty, bun/node version, per-source URL+bytes+SHA-256+duration, final artifact SHA-256. Lets consumers defend every number months later.
- **Sanity checks** — built into `src/build.ts`. Fails the build if any source drops below threshold (arena<50, routerai<50, HLE<5, SWE-bench Verified<20, models with bad canonical_id, schema drift). Warnings for SWE-bench Lite/Multilingual underflow and unmatched display names.
- **CI regression gate** — `.github/workflows/build.yml` runs `bun src/diff.ts` between `HEAD:supplement.json` and the new build; fails if any per-source count dropped >30% overnight.

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
├── build.ts        # Main: parallel fetch all sources, merge to model-centric schema
├── build-types.ts  # Shared types: ModelEntry, Unmatched (avoids circular imports)
├── arena.ts        # Arena AI + AlpacaEval scores
├── routerai.ts     # RouterAI models with RUB pricing
├── currency.ts     # CBR USD/RUB rates
├── scores.ts       # HLE + SWE-bench (Verified/Lite/Multilingual) + SWE-bench Pro
├── normalize.ts    # Shared model-name normalization (vendor/date/parenthesized strips)
├── canonical.ts    # Source-specific → canonical (vendor/name) mapping
├── provenance.ts   # git info, env fingerprint, SHA-256 helpers
├── checks.ts       # post-merge sanity checks (errors + warnings)
└── diff.ts         # CI regression gate between two supplement.json files
```
