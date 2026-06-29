# models-supplement

Lightweight supplement layer for [models.dev](https://models.dev). Not a fork — just an add-on.

## What it does

Fetches three data sources and merges them into a single `supplement.json`:

| Source | What | Why it's not in upstream |
|--------|------|--------------------------|
| Arena AI leaderboard | ELO + quality scores | Upstream doesn't track arena |
| AlpacaEval 2.0 LC | Length-controlled winrate | Upstream doesn't track alpaca |
| RouterAI (routerai.ru) | 301 LLM models with RUB pricing | Russian provider, not in upstream |

## Architecture

```
Consumer (AutoTelegramViews / TG_Commentator)
  ├── models.dev/api.json     ← upstream (BASE: KC, tool_call, structured_output)
  └── supplement.json         ← this project (ADD: arena ELO, RUB pricing, currency)
```

Upstream is always fresh. Supplement only adds what upstream doesn't have.

## Build

```bash
bun install
bun src/build.ts
```

Output: `supplement.json`

## Deploy

GitHub Actions builds daily at 06:00 UTC and deploys to GitHub Pages.

Consumers fetch: `https://<user>.github.io/models-supplement/supplement.json`

## Files

```
src/
├── build.ts       # Main: merge all sources → supplement.json
├── arena.ts       # Arena AI + AlpacaEval scores
├── routerai.ts    # RouterAI models with RUB pricing
└── currency.ts    # CBR USD/RUB rates
```
