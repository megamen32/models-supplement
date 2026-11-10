# models-supplement

Model catalog and benchmark supplement for [models.dev](https://models.dev). The
upstream catalog is fetched as the base; this project adds benchmark, pricing,
and arena records without dropping upstream capabilities.

## What it does

Fetches the models.dev catalog plus supplemental data sources and merges them
into a single `supplement.json` keyed by **canonical model id** (vendor/name,
the same shape as models.dev):

| Source | What | Why it's not in upstream |
|--------|------|--------------------------|
| models.dev | Base provider/model catalog, capabilities, limits, and pricing | Canonical base data |
| Arena AI leaderboard | Real ELO rows only (text + code) | Upstream doesn't track arena |
| AlpacaEval 2.0 LC | Length-controlled winrate, attached only to models already known | Upstream doesn't track alpaca |
| RouterAI (routerai.ru) | 300+ LLM models with RUB pricing | Russian provider, not in upstream |
| HLE (Humanity's Last Exam) | Frontier expert-level benchmark (CAIS) | Hard-to-find in upstream |
| SWE-bench Pro | Code-agent benchmark from CAIS Dashboard | Held out from upstream |
| SWE-bench Verified | 500 human-validated GitHub-issue tasks | Not in upstream |
| SWE-bench Lite | 300 curated coding tasks | Not in upstream |
| SWE-bench Multilingual | 300 i18n coding tasks | Not in upstream |
| Aider Polyglot | Aider 225-exercise pass_rate_2 with command/edit-format/date provenance | Independent source; never folded into SWE-bench Pro |
| LiveBench release 20261106 | Coding and category scores from the pinned release | Fable 5.2 stays separate from Fable 5.1 |
| Terminal-Bench 2.1 | Official Harbor rows with model, agent, reasoning effort and accuracy | Explicit max_accuracy aggregation; never folded into SWE-bench Pro |

## Architecture

```
Consumer (AutoTelegramViews / TG_Commentator / LastHumanCommit)
  ├── supplement.json         ← models.dev base + arena, RUB pricing, and all benchmark scores
  └── coding-benchmarks.json  ← how well each model writes code (per-benchmark scores, standing, coverage)
```

Upstream is fetched on every build. If the live request fails, the previous
generated artifact is used as a bounded fallback and the failed request remains
visible in `provenance.sources` with `fallback: true`. Each model keeps the
unchanged upstream record under `models_dev`; consumers can do
`supplement.models["<vendor>/<model>"]` and get the base catalog plus all extra
facts at once.

### Source status: nothing is invented, failures are visible

Every source returns `{ok, records, error?}`. A source that fails adds nothing
new: its fields are carried over from the previous `supplement.json`, and
`sources.<name>` says so:

```ts
sources: {
  upstream | arena | alpaca_lc | routerai | hle | swe_bench_leaderboard: {
    url: string,
    status: "ok" | "stale" | "absent",   // stale = failed, previous data carried; absent = failed, nothing to carry
    error?: string,                        // why the live fetch failed
    last_ok_at?: string,                   // when this source last delivered live data
    carried?: number,                      // values carried over (stale only)
  }
}
```

With no previous file a failed source leaves its fields absent. An `arena`
field exists only with a real Arena score (`elo > 0`); AlpacaEval rows that
match no known model are dropped (there are no `unknown/...` ids). A failing
RouterAI, CAIS or SWE-bench source no longer aborts the build.

## Model ids (schema 3.0 — ids changed)

One model has exactly one id. Every source goes through the single pure
`canonicalId(vendor, name)` in `src/canonical.ts`:

- vendor is lower-cased and run through one alias table (`xai`→`x-ai`,
  `meta`→`meta-llama`, `zhipuai`/`zai`→`z-ai`, `mistral`→`mistralai`, ...); a
  missing vendor is inferred from the model family, otherwise the row is dropped;
- version numbers keep the dot (`claude-opus-5.5`, never `5-5`); dates and
  parenthesised annotations are dropped;
- Anthropic names are `claude-<family>-<version>`;
- moving aliases (`~anthropic/claude-opus-latest`) are not models and are not emitted;
- when a model exists in models.dev, **its id is the reference spelling** and
  wins (`xai/grok-4.7`, `anthropic/claude-opus-5-5`); twins from other sources
  merge into that one entry, so price and scores sit together.

`checks.ts` fails the build when two ids differ only by `.`/`-` or by vendor
alias, or when an id starts with `~`. **Ids changed relative to schema 2.0**
(about 450 twin and fabricated ids merged or removed); consumers keyed by an old
dashed id should look up the models.dev spelling.

## Output schema (v3.0, model-centric)

```ts
{
  generated_at: string,
  schema_version: "3.0",
  provenance: { git, env, sources: FetchStat[], output_sha256, dry_run },
  currency: { usd_rub, source, fetched_at } | null,   // carried when RouterAI failed
  models: {
    "<vendor>/<model>": {
      canonical_id: "anthropic/claude-opus-4-6",
      vendor: "anthropic",
      display_name: "Claude Opus 4.6",
      models_dev?:  { provider_id, provider_name, model: { /* models.dev fields */ } },
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
  sources: { <name>: { url, status, error?, last_ok_at?, carried? } },   // see "Source status"
}
```

Each `models[]` entry only has sub-records for sources that contain the model.
`unmatched_display_names` surfaces HLE/SWE-bench entries whose vendor couldn't be inferred.

## Coding benchmark manifest

`coding-benchmarks.json` answers "how well does each model write code". It is
generated from the completed `supplement.json` (schema `1.1`; the 1.0 keys and
every per-model field are unchanged, new fields are additions).

- `models[id]` keeps the old primary row (`source`, `benchmark`, `normalized_score`,
  `score`, `raw_score`, `source_url`, `date`): first of SWE-bench Pro, Verified,
  Lite, Multilingual. Top-level `metric` stays `"swebench_pro"` (consumers filter
  rows with `source == metric`).
- `models[id].benchmarks` holds **each benchmark's score separately**; the scales
  are never mixed.
- `models[id].coding = { score, basis, rank, of }`: `score` is the mean of
  per-benchmark **percentiles** (0–100, one decimal) among models that have that
  benchmark, `basis` lists the benchmarks that went in (a benchmark needs at least
  5 ranked models), `rank` is 1 = best (ties share a rank). A model with no coding
  benchmark has no `coding` and is not in `models` — never a guess.
- `metrics`: the benchmarks used for `coding.score`.
- `scaffolds`: leaderboard rows that are agent scaffolds, not models (names with
  `" + "`, `agent`, `lingxi`, `cortexa`, `w/ review`). Listed here, never ranked.
- `coverage`: the current flagships (fixed list in `src/coding-benchmarks.ts`) with
  `present` (in the catalog), `scored` (has a coding score) and `benchmarks`.
  `scored: false` is a data gap — leaderboards lag new models — not a bad model.

The manifest also records the SHA-256 of the exact `supplement.json` bytes, the
source artifact's generated time and git state, and the relevant fetch statistics.


### Independent coding-source slices

Aider Polyglot is fetched from the upstream YAML and stores every model or
agent variant in aider_polyglot.variants. The model-level score is explicitly
aggregated as max_pass_rate_2 over model variants; agent variants remain in the
array and are never silently discarded.

LiveBench is pinned to release 20261106. Its coding score is kept in
livebench_coding and includes the release and table/categories URLs, so
Claude Fable 5.2 is not substituted with Fable 5.1.

Terminal-Bench 2.1 is read from Harbor's public leaderboard-read POST endpoint.
Each model stores every published agent x model x reasoning-effort row with
accuracy, rank, links and metrics. The model-level terminal_bench.score uses
the explicit max_accuracy aggregation and retains all rows plus the Harbor
package, release and endpoint provenance.

These three slices are available in supplement.json and coding-benchmarks.json
as independent benchmarks. They do not enter the SWE-bench Pro metric,
cross-benchmark coding.score, or LHC model tiering.

## Build

```bash
bun install
bun test                      # unit tests (also run by CI before the build)
bun src/build.ts              # build + write supplement.json and coding-benchmarks.json
bun src/build.ts --dry-run    # preview only, no file written
```

## Reliability features

Mirrors the manifest + sanity-check + diff-gate pattern from `llm-inference-benchmark` (Happynood, 2025).

- **`provenance` block in output** — git commit/branch/dirty, bun/node version, per-source URL+bytes+SHA-256+duration, final artifact SHA-256.
- **Sanity checks** — `src/checks.ts`. A source whose live fetch **succeeded** but collapsed is an error (real Arena rows < 50, RouterAI < 50, HLE < 5, SWE-bench Verified < 20); a **stale or absent** source is a warning (`source_stale`, `source_absent`) and its carried data is judged only as a warning. Errors also for a bad id, duplicate ids (dot/dash or vendor-alias twins, `~` ids) and schema drift. Warnings for SWE-bench Lite/Multilingual underflow and unmatched names.
- **CI** — `.github/workflows/build.yml` runs `bun test`, the build, then `bun src/diff.ts` between `HEAD:supplement.json` and the new build (fails if any per-source count dropped >30%; skipped once when `schema_version` changed).

```bash
git show HEAD:supplement.json > /tmp/prev.json
bun src/diff.ts /tmp/prev.json supplement.json 30
```

## Deploy

GitHub Actions builds daily at 06:00 UTC and deploys to GitHub Pages.

Consumers fetch `https://<user>.github.io/models-supplement/supplement.json` or
the smaller `https://<user>.github.io/models-supplement/coding-benchmarks.json`.

## Files

```
src/
├── build.ts        # entry: fetch all sources in parallel, assemble, check, write
├── assemble.ts     # pure: source results + previous file -> entries, states, currency
├── source.ts       # pure: SourceResult, carry-over from previous file, source status
├── merge.ts        # pure: one id per model, twin merge, drop fabricated rows
├── canonical.ts    # the single canonicalId(vendor, name) + vendor alias table
├── normalize.ts    # raw leaderboard name cleanup (scaffold prefix, vendor, dates)
├── upstream.ts     # models.dev fetch, flattening, provenance, and offline fallback
├── arena.ts        # Arena AI + AlpacaEval fetch/parse
├── routerai.ts     # RouterAI models with RUB pricing
├── currency.ts     # CBR USD/RUB rates
├── scores.ts       # HLE + SWE-bench (Verified/Lite/Multilingual) + SWE-bench Pro
├── coding-benchmarks.ts # coding manifest: per-benchmark scores, percentile standing, scaffolds, coverage
├── build-types.ts  # shared types
├── provenance.ts   # git info, env fingerprint, SHA-256
├── checks.ts       # post-merge sanity checks (errors + warnings)
└── diff.ts         # CI regression gate between two supplement.json files
tests/              # bun test: canonical, merge, source, assemble, checks, parsers, coding view, upstream
```
