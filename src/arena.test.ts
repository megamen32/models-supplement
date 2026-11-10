import { expect, test } from "bun:test";
import { parseArenaBoard, parseAlpaca } from "./arena";

const board = (name: string, models: unknown[]) =>
  JSON.stringify({ meta: { leaderboard: name, model_count: models.length, last_updated: "2026-11-01" }, models });

const text = board("text", [
  { rank: 1, model: "claude-opus-4-6", vendor: "Anthropic", score: 1500, ci: 5, votes: 9000, license: "proprietary" },
  { rank: 2, model: "gpt-5-4", vendor: "OpenAI", score: 1400, ci: 5, votes: 800, license: "proprietary" },
]);
const code = board("code", [
  { rank: 1, model: "gpt-5-4", vendor: "OpenAI", score: 1450, ci: 7, votes: 3000, license: "proprietary" },
]);

test("arena text and code boards are kept side by side, not overwritten", () => {
  const t = parseArenaBoard(text, "text");
  const c = parseArenaBoard(code, "code");
  expect(t.ok && c.ok).toBe(true);
  const fields = [...t.records, ...c.records].filter((r) => r.id === "openai/gpt-5.4").map((r) => r.field).sort();
  expect(fields).toEqual(["arena.code", "arena.text"]);
  const top = t.records.find((r) => r.id === "anthropic/claude-opus-4.6")!;
  expect((top.value as { elo: number }).elo).toBe(1500);
});

test("arena garbage or empty board is a failed source, not an empty success", () => {
  expect(parseArenaBoard("<html>429</html>", "text").ok).toBe(false);
  expect(parseArenaBoard(board("text", []), "text").ok).toBe(false);
});

test("arena rows without a real score produce no record", () => {
  const r = parseArenaBoard(board("text", [{ rank: 1, model: "x-model", vendor: "OpenAI", score: 0, ci: 0, votes: 1, license: "" }]), "text");
  expect(r.records.length).toBe(0);
});

test("alpaca rows are attach-only and never invent ids", () => {
  const csv = "name,win_rate,length_controlled_winrate,n_total\ngpt-4o-2024-05-13,50,57.5,805\nnullmodel,76.9,86.4,805\n";
  const r = parseAlpaca(csv);
  expect(r.ok).toBe(true);
  expect(r.records.map((x) => x.id)).toEqual(["openai/gpt-4o"]);
  expect(r.records.every((x) => x.attach_only)).toBe(true);
});
