/**
 * arena.ts — Arena AI leaderboards (text, code) and AlpacaEval LC.
 *
 * Pure parsers (text in, SourceResult out) plus thin fetchers. An arena record
 * exists only for a row with a real arena score; AlpacaEval rows only ever
 * attach to models other sources already know.
 */

import type { ArenaBoard, AlpacaLcEntry } from "./build-types";
import { canonicalId } from "./canonical";
import { failedResult, runSource, type Contribution, type SourceResult } from "./source";

export const ARENA_BASE = "https://api.wulong.dev/arena-ai-leaderboards/v1/leaderboard";
export const ALPACA_LC_URL =
  "https://raw.githubusercontent.com/tatsu-lab/alpaca_eval/main/" +
  "src/alpaca_eval/leaderboards/data_AlpacaEval_2/" +
  "weighted_alpaca_eval_gpt4_turbo_leaderboard.csv";

const HIGH_CONFIDENCE_VOTES = 5000;
const MEDIUM_CONFIDENCE_VOTES = 1000;

interface RawArenaModel { rank: number; model: string; vendor: string; score: number; ci: number; votes: number; license: string }
interface RawArenaResponse { meta?: { last_updated?: string }; models?: RawArenaModel[] }

export type ArenaCategory = "text" | "code";

export function parseArenaBoard(text: string, category: ArenaCategory): SourceResult {
  let body: RawArenaResponse;
  try { body = JSON.parse(text) as RawArenaResponse; } catch { return failedResult("not JSON"); }
  const rows = (body.models ?? []).filter((m) => m && typeof m.model === "string" && Number.isFinite(m.score) && m.score > 0);
  if (rows.length === 0) return failedResult("no rows with a score");

  const scores = rows.map((m) => m.score);
  const min = Math.min(...scores);
  const range = Math.max(...scores) - min || 1;
  const records: Contribution[] = [];
  for (const m of rows) {
    const id = canonicalId(m.vendor, m.model);
    if (!id) continue;
    const value: ArenaBoard = {
      elo: m.score,
      score: Math.round((0.4 + 0.58 * ((m.score - min) / range)) * 10000) / 10000,
      rank: m.rank,
      ci: m.ci,
      votes: m.votes,
      confidence: m.votes >= HIGH_CONFIDENCE_VOTES ? "high" : m.votes >= MEDIUM_CONFIDENCE_VOTES ? "medium" : "low",
      license: m.license,
      last_updated: body.meta?.last_updated,
    };
    records.push({ id, field: `arena.${category}`, value, display_name: m.model });
  }
  return { ok: true, records };
}

export const fetchArena = (category: ArenaCategory) =>
  runSource(`arena_${category}`, `${ARENA_BASE}?name=${category}`, (t) => parseArenaBoard(t, category));

/** AlpacaEval CSV → attach-only records. Row names are matched by exact canonical id. */
export function parseAlpaca(csv: string): SourceResult {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return failedResult("no rows");
  const header = lines[0].split(",").map((c) => c.trim());
  const lcCol = header.indexOf("length_controlled_winrate");
  if (lcCol < 0) return failedResult("missing length_controlled_winrate column");
  const wrCol = header.indexOf("win_rate");
  const nCol = header.indexOf("n_total");

  const records: Contribution[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const raw = (cols[0] ?? "").trim();
    const lc = Number(cols[lcCol]?.trim());
    if (!raw || !Number.isFinite(lc) || lc <= 0) continue;
    const slash = raw.indexOf("/");
    const id = slash < 0 ? canonicalId(null, raw) : canonicalId(raw.slice(0, slash), raw.slice(slash + 1));
    if (!id) continue;
    const wr = wrCol >= 0 ? Number(cols[wrCol]) / 100 : lc / 100;
    const value: AlpacaLcEntry = {
      winrate: Math.round(wr * 10000) / 10000,
      lc_winrate: Math.round((lc / 100) * 10000) / 10000,
      n: nCol >= 0 ? Number(cols[nCol]) || 0 : 0,
    };
    records.push({ id, field: "alpaca_lc", value, attach_only: true });
  }
  return { ok: true, records };
}

export const fetchAlpaca = () => runSource("alpaca_lc", ALPACA_LC_URL, parseAlpaca);
