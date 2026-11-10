import { expect, test } from "bun:test";
import { reconcileModels } from "../src/merge";
import { findIdProblems } from "../src/checks";
import type { ModelEntry } from "../src/build-types";

const e = (id: string, extra: Partial<ModelEntry>): ModelEntry =>
  ({ canonical_id: id, vendor: id.split("/")[0], benchmark_sources: [], ...extra }) as ModelEntry;

const routerai = { id: "x", input_rub_per_token: 1, output_rub_per_token: 2, input_usd_per_1m: 1, output_usd_per_1m: 2,
  supports_vision: false, supports_tools: true, supports_structured_output: false, reasoning: false };
const md = { provider_id: "anthropic", model: { id: "m" } };

test("dot/dash twins merge into one entry with price and score; models.dev spelling wins", () => {
  const out = reconcileModels({
    "anthropic/claude-opus-5.5": e("anthropic/claude-opus-5.5", { routerai, display_name: "Anthropic: Claude Opus 5.5" }),
    "anthropic/claude-opus-5-5": e("anthropic/claude-opus-5-5", { hle: { score: 0.4, raw_score: 40 }, models_dev: md }),
    "x-ai/grok-4-6": e("x-ai/grok-4-6", { hle: { score: 0.3, raw_score: 30 } }),
    "x-ai/grok-4.6": e("x-ai/grok-4.6", { routerai }),
  });
  expect(Object.keys(out).sort()).toEqual(["anthropic/claude-opus-5-5", "x-ai/grok-4.6"]);
  const m = out["anthropic/claude-opus-5-5"];
  expect(m.routerai).toBeDefined();
  expect(m.hle?.raw_score).toBe(40);
  expect(m.canonical_id).toBe("anthropic/claude-opus-5-5");
  expect(out["x-ai/grok-4.6"].hle).toBeDefined();
  expect(out["x-ai/grok-4.6"].routerai).toBeDefined();
});

test("vendor alias twins merge; models.dev vendor spelling is the reference", () => {
  const out = reconcileModels({
    "xai/grok-4.7": e("xai/grok-4.7", { models_dev: md }),
    "x-ai/grok-4.7": e("x-ai/grok-4.7", { routerai }),
  });
  expect(Object.keys(out)).toEqual(["xai/grok-4.7"]);
  expect(out["xai/grok-4.7"].routerai).toBeDefined();
  expect(out["xai/grok-4.7"].vendor).toBe("xai");
});

test("distinct dated models.dev ids are never merged", () => {
  const out = reconcileModels({
    "anthropic/claude-3-5-sonnet-20241022": e("anthropic/claude-3-5-sonnet-20241022", { models_dev: md }),
    "anthropic/claude-3-5-sonnet-20240620": e("anthropic/claude-3-5-sonnet-20240620", { models_dev: md }),
  });
  expect(Object.keys(out).length).toBe(2);
});

test("~ aliases and unresolvable ids are dropped; alpaca-only orphans are dropped", () => {
  const alpaca = { alpaca_lc: { winrate: 1, lc_winrate: 1, n: 1 } };
  const out = reconcileModels({
    "~anthropic/claude-fable-latest": e("~anthropic/claude-fable-latest", { routerai }),
    "~openai/gpt-latest": e("~openai/gpt-latest", { models_dev: md }),
    "unknown/nullmodel": e("unknown/nullmodel", alpaca),
    "unknown/gpt-4o": e("unknown/gpt-4o", alpaca),
    "openai/gpt-4o": e("openai/gpt-4o", { routerai }),
  });
  expect(Object.keys(out)).toEqual(["openai/gpt-4o"]);
  expect(out["openai/gpt-4o"].alpaca_lc).toBeDefined();
});

test("fabricated arena records (elo 0) are removed", () => {
  const arena = { elo: 0, score: 0.8, rank: 0, leaderboard: "text", ci: 0, votes: 1, confidence: "low", license: "", sources: ["alpaca_lc"] };
  const out = reconcileModels({ "openai/gpt-4o": e("openai/gpt-4o", { routerai, arena }) });
  expect(out["openai/gpt-4o"].arena).toBeUndefined();
  expect(out["openai/gpt-4o"].benchmark_sources).toEqual(["routerai"]);
});

test("findIdProblems flags ~ ids and dot/dash or vendor-alias twins", () => {
  expect(findIdProblems(["a/b-1.2", "a/b-1-2"]).length).toBe(1);
  expect(findIdProblems(["xai/grok-4", "x-ai/grok-4"]).length).toBe(1);
  expect(findIdProblems(["~openai/gpt-latest"]).length).toBe(1);
  expect(findIdProblems(["openai/gpt-5.4", "openai/gpt-5.4-mini"]).length).toBe(0);
});
