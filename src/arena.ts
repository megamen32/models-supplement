/**
 * arena.ts — Fetch Arena AI + AlpacaEval LC scores.
 *
 * Two independent sources: Arena (real ELO rows only) and AlpacaEval LC
 * (winrates keyed by raw name; the build attaches them only to models that
 * are already known). Each fetcher returns {ok, records, error, stats}.
 *
 * This file does NOT touch the upstream catalog — it only produces scores.
 */

import { sha256, type FetchStat } from "./provenance";
import type { AlpacaLcEntry } from "./build-types";
import { firstError, type SourceResult } from "./source";

const ARENA_BASE = "https://api.wulong.dev/arena-ai-leaderboards/v1/leaderboard";
const CATEGORIES = ["text", "code"] as const;
type Category = (typeof CATEGORIES)[number];

const ALPACA_LC_URL =
  "https://raw.githubusercontent.com/tatsu-lab/alpaca_eval/main/" +
  "src/alpaca_eval/leaderboards/data_AlpacaEval_2/" +
  "weighted_alpaca_eval_gpt4_turbo_leaderboard.csv";

const HIGH_CONFIDENCE_VOTES = 5000;
const MEDIUM_CONFIDENCE_VOTES = 1000;

const VENDOR_PREFIXES = [
  "anthropic/", "openai/", "google/", "meta/", "mistral/", "deepseek/",
  "xai/", "cohere/", "qwen/", "alibaba/", "nvidia/", "01-ai/", "phind/",
  "zerox/", "together/", "fireworks/", "perplexity/", "ai21/", "moonshotai/",
  "zhipuai/", "xiaomi/",
];

export interface ArenaEntry {
  leaderboard: Category;
  rank: number;
  elo: number;
  ci: number;
  votes: number;
  vendor: string;
  license: string;
  score: number;
  confidence: "high" | "medium" | "low";
  categories: string[];
  lastUpdated?: string;
  sourceUrl?: string;
  fetchedAt?: string;
  sources: string[];
  /** Never set by this module; AlpacaEval is a separate source. */
  alpaca_lc?: AlpacaLcEntry;
}

export interface ArenaData {
  [normalizedModelName: string]: ArenaEntry;
}

interface RawArenaModel {
  rank: number;
  model: string;
  vendor: string;
  score: number;
  ci: number;
  votes: number;
  license: string;
}

interface RawArenaResponse {
  meta: {
    leaderboard: string;
    model_count: number;
    last_updated?: string;
    source_url?: string;
    fetched_at?: string;
  };
  models: RawArenaModel[];
}

const CATEGORY_TASK_MAP: Record<Category, string[]> = {
  text: ["default", "review", "documentation", "debugging"],
  code: ["coding"],
};

function normalizeName(raw: string): string {
  let n = raw.toLowerCase().trim();
  for (const p of VENDOR_PREFIXES) {
    if (n.startsWith(p)) { n = n.slice(p.length); break; }
  }
  return n;
}

async function fetchArenaLeaderboards(): Promise<{
  data: Record<Category, RawArenaResponse>;
  stats: Record<Category, FetchStat>;
}> {
  const data: Partial<Record<Category, RawArenaResponse>> = {};
  const stats: Partial<Record<Category, FetchStat>> = {};
  for (const cat of CATEGORIES) {
    const url = `${ARENA_BASE}?name=${cat}`;
    const t0 = performance.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        console.warn(`[arena] ${cat} failed: HTTP ${res.status}`);
        stats[cat] = {
          url, fetched_at: new Date().toISOString(),
          duration_ms: Math.round(performance.now() - t0),
          bytes: 0, sha256: "", ok: false, error: `HTTP ${res.status}`,
        };
        continue;
      }
      const text = await res.text();
      data[cat] = JSON.parse(text) as RawArenaResponse;
      stats[cat] = {
        url, fetched_at: new Date().toISOString(),
        duration_ms: Math.round(performance.now() - t0),
        bytes: text.length, sha256: sha256(text), ok: true,
      };
      console.log(`[arena] ${cat}: ${data[cat]?.models.length ?? 0} models (${text.length}B)`);
    } catch (e) {
      console.warn(`[arena] ${cat} error: ${e}`);
      stats[cat] = {
        url, fetched_at: new Date().toISOString(),
        duration_ms: Math.round(performance.now() - t0),
        bytes: 0, sha256: "", ok: false, error: String(e),
      };
    }
  }
  return { data: data as Record<Category, RawArenaResponse>, stats: stats as Record<Category, FetchStat> };
}

/** Pure: one arena leaderboard -> records keyed by vendor-stripped lower-case model name. */
export function parseArenaLeaderboard(cat: Category, lb: RawArenaResponse): Record<string, ArenaEntry> {
  const result: Record<string, ArenaEntry> = {};
  if (!lb?.models?.length) return result;
  const scores = lb.models.map((m) => m.score);
  const minElo = Math.min(...scores);
  const eloRange = Math.max(...scores) - minElo || 1;
  for (const m of lb.models) {
    if (!(m.score > 0)) continue; // no real arena score, no record
    const confidence: "high" | "medium" | "low" =
      m.votes >= HIGH_CONFIDENCE_VOTES ? "high" :
      m.votes >= MEDIUM_CONFIDENCE_VOTES ? "medium" : "low";
    result[normalizeName(m.model)] = {
      leaderboard: cat,
      rank: m.rank,
      elo: m.score,
      ci: m.ci,
      votes: m.votes,
      vendor: m.vendor,
      license: m.license,
      score: Math.round((0.4 + 0.58 * ((m.score - minElo) / eloRange)) * 10000) / 10000,
      confidence,
      categories: CATEGORY_TASK_MAP[cat],
      lastUpdated: lb.meta?.last_updated,
      sourceUrl: lb.meta?.source_url,
      fetchedAt: lb.meta?.fetched_at,
      sources: ["arena"],
    };
  }
  return result;
}

/** Pure: AlpacaEval CSV -> length-controlled winrates keyed by the raw model name (lower-case). */
export function parseAlpacaCsv(text: string): Record<string, AlpacaLcEntry> {
  const out: Record<string, AlpacaLcEntry> = {};
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return out;
  const header = lines[0].split(",").map((c) => c.trim());
  const lcCol = header.indexOf("length_controlled_winrate");
  const winrateCol = header.indexOf("win_rate");
  const nTotalCol = header.indexOf("n_total");
  if (lcCol < 0) return out;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const rawKey = (cols[0] ?? "").trim().toLowerCase();
    if (!rawKey || cols.length <= lcCol) continue;
    const lc = Number(cols[lcCol]?.trim());
    if (!Number.isFinite(lc) || lc <= 0) continue;
    const wr = winrateCol >= 0 ? Number(cols[winrateCol]) / 100 : lc / 100;
    const n = nTotalCol >= 0 ? Number(cols[nTotalCol]) || 0 : 0;
    out[rawKey] = {
      winrate: Math.round(wr * 10000) / 10000,
      lc_winrate: Math.round((lc / 100) * 10000) / 10000,
      n,
    };
  }
  return out;
}

/** Arena is ok only when both leaderboards were fetched. */
export async function fetchArena(): Promise<SourceResult<Record<string, ArenaEntry>>> {
  const { data, stats } = await fetchArenaLeaderboards();
  const statList = CATEGORIES.map((c) => ({ name: `arena:${c}`, ...stats[c] }));
  const ok = CATEGORIES.every((c) => stats[c]?.ok && data[c]);
  const records: Record<string, ArenaEntry> = {};
  if (ok) for (const cat of CATEGORIES) Object.assign(records, parseArenaLeaderboard(cat, data[cat]));
  return { ok, records, error: ok ? undefined : firstError(statList), stats: statList };
}

export async function fetchAlpaca(): Promise<SourceResult<Record<string, AlpacaLcEntry>>> {
  const t0 = performance.now();
  const stat = (o: Partial<FetchStat> = {}): FetchStat => ({
    name: "alpaca_lc", url: ALPACA_LC_URL, fetched_at: new Date().toISOString(),
    duration_ms: Math.round(performance.now() - t0), bytes: 0, sha256: "", ok: false, ...o,
  });
  try {
    const res = await fetch(ALPACA_LC_URL, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) { const s = stat({ error: `HTTP ${res.status}` }); return { ok: false, records: {}, error: firstError([s]), stats: [s] }; }
    const text = await res.text();
    const records = parseAlpacaCsv(text);
    const ok = Object.keys(records).length > 0;
    const s = stat({ bytes: text.length, sha256: sha256(text), ok, ...(ok ? {} : { error: "no rows" }) });
    return { ok, records, error: ok ? undefined : "alpaca_lc: no rows", stats: [s] };
  } catch (e) {
    const s = stat({ error: String(e) });
    return { ok: false, records: {}, error: firstError([s]), stats: [s] };
  }
}
