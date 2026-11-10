import { expect, test } from "bun:test";
import { migrateEntries } from "./merge";
import { findIdProblems } from "./checks";
import type { ModelEntry } from "./build-types";

const e = (id: string, extra: Partial<ModelEntry>): ModelEntry =>
  ({ canonical_id: id, vendor: id.split("/")[0], benchmark_sources: [], ...extra }) as ModelEntry;

const routerai = { id: "x", input_rub_per_token: 1, output_rub_per_token: 2, input_usd_per_1m: 1, output_usd_per_1m: 2,
  supports_vision: false, supports_tools: true, supports_structured_output: false, reasoning: false };

test("dot/dash collision groups merge into one entry with price and score", () => {
  const out = migrateEntries({
    "anthropic/claude-opus-5.5": e("anthropic/claude-opus-5.5", { routerai, display_name: "Anthropic: Claude Opus 5.5" }),
    "anthropic/claude-opus-5-5": e("anthropic/claude-opus-5-5", { hle: { score: 0.4, raw_score: 40 }, display_name: "Opus 5.5" }),
    "xai/grok-4-6": e("xai/grok-4-6", { hle: { score: 0.3, raw_score: 30 } }),
    "x-ai/grok-4.6": e("x-ai/grok-4.6", { routerai }),
  });
  expect(Object.keys(out).sort()).toEqual(["anthropic/claude-opus-5.5", "x-ai/grok-4.6"]);
  const m = out["anthropic/claude-opus-5.5"];
  expect(m.routerai).toBeDefined();
  expect(m.hle?.raw_score).toBe(40);
  expect(m.display_name).toBe("Anthropic: Claude Opus 5.5");
  expect(out["x-ai/grok-4.6"].hle).toBeDefined();
  expect(out["x-ai/grok-4.6"].routerai).toBeDefined();
});

test("~ aliases and unresolvable ids are dropped", () => {
  const out = migrateEntries({
    "~anthropic/claude-fable-latest": e("~anthropic/claude-fable-latest", { routerai }),
    "unknown/nullmodel": e("unknown/nullmodel", { alpaca_lc: { winrate: 1, lc_winrate: 1, n: 1 } }),
    "unknown/gpt-4o": e("unknown/gpt-4o", { alpaca_lc: { winrate: 1, lc_winrate: 1, n: 1 } }),
  });
  expect(Object.keys(out)).toEqual(["openai/gpt-4o"]);
});

test("findIdProblems flags ~ ids and dot/dash or vendor-alias twins", () => {
  expect(findIdProblems(["a/b-1.2", "a/b-1-2"]).length).toBe(1);
  expect(findIdProblems(["xai/grok-4", "x-ai/grok-4"]).length).toBe(1);
  expect(findIdProblems(["~openai/gpt-latest"]).length).toBe(1);
  expect(findIdProblems(["openai/gpt-5.4", "openai/gpt-5.4-mini"]).length).toBe(0);
});
