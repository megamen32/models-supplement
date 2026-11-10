import { expect, test } from "bun:test";
import { assemble, type SourceDef } from "./assemble";
import type { SourceResult } from "./source";
import { fetchRouterAI, parseRouterAI } from "./routerai";

const board = { elo: 1500, score: 0.98, rank: 1, ci: 5, votes: 9000, confidence: "high", license: "x", last_updated: "2026-11-01" };
const defs: SourceDef[] = [
  { name: "arena_text", url: "u1", owns: ["arena.text"] },
  { name: "alpaca_lc", url: "u2", owns: ["alpaca_lc"] },
  { name: "hle", url: "u3", owns: ["hle"] },
];
const ok = (records: SourceResult["records"]): SourceResult => ({ ok: true, records });
const failed: SourceResult = { ok: false, records: [], error: "HTTP 429" };

const prev = {
  generated_at: "2026-11-01T00:00:00Z",
  schema_version: "3.0",
  sources: { arena_text: { url: "u1", status: "ok", records: 1, last_ok_at: "2026-11-01T00:00:00Z" } },
  models: {
    "anthropic/claude-opus-4.6": {
      canonical_id: "anthropic/claude-opus-4.6", vendor: "anthropic", benchmark_sources: ["arena"], arena: { text: board },
    },
  },
};

test("failed source + previous file: previous values kept and marked stale", () => {
  const r = assemble({ arena_text: failed, alpaca_lc: ok([]), hle: ok([]) }, prev, defs);
  expect(r.models["anthropic/claude-opus-4.6"].arena?.text?.elo).toBe(1500);
  expect(r.sourceStatus.arena_text).toMatchObject({ status: "stale", error: "HTTP 429", last_ok_at: "2026-11-01T00:00:00Z" });
  expect(r.sourceStatus.hle.status).toBe("ok");
});

test("failed source + no previous file: no arena field anywhere", () => {
  const hle = ok([{ id: "openai/gpt-5.4", field: "hle", value: { score: 0.3, raw_score: 30 } }]);
  const r = assemble({ arena_text: failed, alpaca_lc: ok([]), hle }, null, defs);
  expect(Object.values(r.models).some((m) => m.arena !== undefined)).toBe(false);
  expect(r.sourceStatus.arena_text.status).toBe("failed");
  expect(Object.keys(r.models)).toEqual(["openai/gpt-5.4"]);
});

test("a fresh ok source replaces, never mixes with, previous data", () => {
  const fresh = ok([{ id: "openai/gpt-5.4", field: "arena.text", value: { ...board, elo: 1400 } }]);
  const r = assemble({ arena_text: fresh, alpaca_lc: ok([]), hle: ok([]) }, prev, defs);
  expect(Object.keys(r.models)).toEqual(["openai/gpt-5.4"]);
});

test("alpaca attaches only to known models, otherwise dropped", () => {
  const alp = ok([
    { id: "openai/gpt-5.4", field: "alpaca_lc", value: { winrate: 0.5, lc_winrate: 0.5, n: 1 }, attach_only: true },
    { id: "openai/ghost", field: "alpaca_lc", value: { winrate: 0.5, lc_winrate: 0.5, n: 1 }, attach_only: true },
  ]);
  const hle = ok([{ id: "openai/gpt-5.4", field: "hle", value: { score: 0.3, raw_score: 30 } }]);
  const r = assemble({ arena_text: failed, alpaca_lc: alp, hle }, null, defs);
  expect(Object.keys(r.models)).toEqual(["openai/gpt-5.4"]);
  expect(r.models["openai/gpt-5.4"].alpaca_lc).toBeDefined();
});

test("old-format previous: fake arena records (elo 0) are dropped, flat arena becomes arena.<board>", () => {
  const old = {
    generated_at: "2026-11-09T00:00:00Z", schema_version: "2.0",
    models: {
      "unknown/toa": { canonical_id: "unknown/toa", vendor: "unknown", benchmark_sources: ["arena"],
        arena: { elo: 0, score: 0.5, rank: 0, leaderboard: "text", sources: ["alpaca_lc"] } },
      "openai/gpt-5.4": { canonical_id: "openai/gpt-5.4", vendor: "openai", benchmark_sources: ["arena"],
        arena: { elo: 1400, score: 0.9, rank: 2, leaderboard: "code", ci: 1, votes: 5, confidence: "low", license: "", sources: ["arena"] } },
    },
  };
  const r = assemble({ arena_text: failed, alpaca_lc: failed, hle: failed }, old, defs);
  expect(Object.keys(r.models)).toEqual(["openai/gpt-5.4"]);
  expect(r.models["openai/gpt-5.4"].arena?.code?.elo).toBe(1400);
  expect(r.models["openai/gpt-5.4"].arena?.text).toBeUndefined();
});

test("routerai failure does not throw", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response("down", { status: 500 })) as typeof fetch;
  try {
    const r = await fetchRouterAI();
    expect(r.ok).toBe(false);
    expect(r.records).toEqual([]);
    expect(r.error).toBeDefined();
  } finally {
    globalThis.fetch = real;
  }
  expect(parseRouterAI("not json", 90).ok).toBe(false);
});

test("routerai parse: ids go through canonicalId, ~ aliases dropped", () => {
  const body = JSON.stringify({ data: [
    { id: "anthropic/claude-opus-5.5", name: "A", pricing: { prompt: 0.0001, completion: 0.0002 }, architecture: { output_modalities: ["text"], input_modalities: ["text"] } },
    { id: "~anthropic/claude-opus-latest", name: "B", pricing: { prompt: 0.0001, completion: 0.0002 }, architecture: { output_modalities: ["text"] } },
    { id: "x-ai/grok-4.3", name: "G", pricing: { prompt: 0, completion: 0 }, architecture: { output_modalities: ["text"] } },
  ] });
  const r = parseRouterAI(body, 100);
  expect(r.records.map((x) => x.id).sort()).toEqual(["anthropic/claude-opus-5.5", "x-ai/grok-4.3"]);
});
