import { expect, test } from "bun:test";
import { carryFields, lastOkAt, parsePrevious, sourceState } from "../src/source";
import type { ModelEntry } from "../src/build-types";

const e = (id: string, extra: object): ModelEntry =>
  ({ canonical_id: id, vendor: id.split("/")[0], benchmark_sources: [], ...extra }) as ModelEntry;

const prev = parsePrevious(JSON.stringify({
  generated_at: "2026-11-09T00:00:00Z",
  models: {
    "openai/gpt-5": e("openai/gpt-5", { hle: { score: 0.3, raw_score: 30 }, routerai: { id: "r" }, display_name: "GPT-5" }),
    "unknown/x": e("unknown/x", { arena: { elo: 0, score: 0.5, sources: ["alpaca_lc"] } }),
  },
  provenance: { sources: [
    { name: "cais_dashboard", url: "u", ok: true, fetched_at: "2026-11-09T06:00:00Z", duration_ms: 1, bytes: 1, sha256: "" },
    { name: "arena:text", url: "u", ok: false, fetched_at: "2026-11-09T06:00:00Z", duration_ms: 1, bytes: 0, sha256: "" },
  ] },
}));

test("a failed source carries only its own fields from the previous file", () => {
  const fresh: Record<string, ModelEntry> = {};
  const n = carryFields(fresh, prev!.models, ["hle", "swebench_pro"]);
  expect(n).toBe(1);
  expect(fresh["openai/gpt-5"].hle?.raw_score).toBe(30);
  expect((fresh["openai/gpt-5"] as unknown as Record<string, unknown>).routerai).toBeUndefined();
});

test("fabricated arena rows (elo 0) are never carried", () => {
  const fresh: Record<string, ModelEntry> = {};
  expect(carryFields(fresh, prev!.models, ["arena"])).toBe(0);
  expect(Object.keys(fresh)).toEqual([]);
});

test("carry does not overwrite fresh values", () => {
  const fresh = { "openai/gpt-5": e("openai/gpt-5", { hle: { score: 0.9, raw_score: 90 } }) };
  carryFields(fresh, prev!.models, ["hle"]);
  expect(fresh["openai/gpt-5"].hle?.raw_score).toBe(90);
});

test("source state: ok / stale / absent", () => {
  const base = { url: "u", prev, now: "2026-11-10T00:00:00Z" };
  expect(sourceState({ ...base, name: "hle", ok: true, carried: 0 })).toEqual({ url: "u", status: "ok", last_ok_at: "2026-11-10T00:00:00Z" });
  const stale = sourceState({ ...base, name: "hle", ok: false, error: "HTTP 500", carried: 3 });
  expect(stale).toMatchObject({ status: "stale", error: "HTTP 500", last_ok_at: "2026-11-09T06:00:00Z", carried: 3 });
  const absent = sourceState({ ...base, name: "arena", ok: false, error: "HTTP 429", carried: 0 });
  expect(absent.status).toBe("absent");
  expect(absent.last_ok_at).toBeUndefined();
  expect(sourceState({ ...base, prev: null, name: "hle", ok: false, carried: 0 }).status).toBe("absent");
});

test("parsePrevious rejects junk", () => {
  expect(parsePrevious("not json")).toBeNull();
  expect(parsePrevious("{}")).toBeNull();
  expect(lastOkAt(null, "hle")).toBeUndefined();
});
