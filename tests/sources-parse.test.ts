import { expect, test } from "bun:test";
import { parseAlpacaCsv, parseArenaLeaderboard } from "../src/arena";
import { parseRouterAICatalog } from "../src/routerai";

test("arena rows keep real elo and are keyed by vendor-stripped lower-case name; no fuzzy aliases", () => {
  const out = parseArenaLeaderboard("text", {
    meta: { leaderboard: "text", model_count: 2, last_updated: "d" },
    models: [
      { rank: 1, model: "claude-opus-4-6", vendor: "Anthropic", score: 1500, ci: 5, votes: 9000, license: "prop" },
      { rank: 2, model: "gpt-5", vendor: "OpenAI", score: 1400, ci: 5, votes: 100, license: "prop" },
    ],
  });
  expect(Object.keys(out).sort()).toEqual(["claude-opus-4-6", "gpt-5"]);
  expect(out["claude-opus-4-6"].elo).toBe(1500);
  expect(out["claude-opus-4-6"].confidence).toBe("high");
  expect(out["gpt-5"].confidence).toBe("low");
  expect(out["claude-opus-4-6"].alpaca_lc).toBeUndefined();
});

test("alpaca csv rows parse to lc winrate keyed by the raw name; no suffix stripping", () => {
  const csv = "name,win_rate,length_controlled_winrate,n_total\ngpt-4o-mini,50,45.5,805\ngpt-4o,60,57.5,805\nbroken,,,\n";
  const out = parseAlpacaCsv(csv);
  expect(Object.keys(out).sort()).toEqual(["gpt-4o", "gpt-4o-mini"]);
  expect(out["gpt-4o-mini"]).toEqual({ winrate: 0.5, lc_winrate: 0.455, n: 805 });
});

test("routerai catalog parses LLMs and prices; no throw on empty", () => {
  const catalog = [
    { id: "x-ai/grok-4.7", name: "Grok", pricing: { prompt: 0.0001, completion: 0.0002 },
      architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: ["tools"] },
    { id: "img/model", architecture: { output_modalities: ["image"] } },
  ];
  const out = parseRouterAICatalog(catalog, 100);
  expect(Object.keys(out)).toEqual(["x-ai/grok-4.7"]);
  expect(out["x-ai/grok-4.7"].input_usd_per_1m).toBe(1);
  expect(out["x-ai/grok-4.7"].supports_tools).toBe(true);
  expect(parseRouterAICatalog([], 100)).toEqual({});
});
