/**
 * arena.ts — Fetch Arena AI + AlpacaEval LC scores.
 *
 * Outputs a flat lookup keyed by normalized model name. Each entry has a
 * unified `score` (0.4..0.98 for arena, raw winrate for alpaca) and a
 * `sources` array so consumers know exactly where each score came from.
 *
 * This file does NOT touch the upstream catalog — it only produces scores.
 */

import { sha256, type FetchStat } from "./provenance";

const ARENA_BASE = "https://api.wulong.dev/arena-ai-leaderboards/v1/leaderboard";
const CATEGORIES = ["text", "code"] as const;
type Category = (typeof CATEGORIES)[number];

const ALPACA_LC_URL =
  "https://raw.githubusercontent.com/tatsu-lab/alpaca_eval/main/" +
  "src/alpaca_eval/leaderboards/data_AlpacaEval_2/" +
  "weighted_alpaca_eval_gpt4_turbo_leaderboard.csv";

const ALPACA_VENDOR_PREFIXES = [
  "meta-llama/", "meta/", "openai/", "anthropic/", "google/",
  "alibaba/", "qwen/", "mistral/", "deepseek/", "xai/", "cohere/",
  "nvidia/", "moonshotai/", "xiaomi/", "zhipuai/", "z-ai/", "01-ai/",
  "NousResearch/", "HuggingFaceH4/", "lmsys/",
];

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

function stripVersion(id: string): string {
  return id.replace(/[.-]\d+(?:\.\d+)*$/, "");
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

function normalizeAlpacaKey(raw: string): string {
  let n = raw.toLowerCase().trim();
  for (const p of ALPACA_VENDOR_PREFIXES) {
    if (n.startsWith(p)) { n = n.slice(p.length); break; }
  }
  n = n.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "");
  n = n.replace(/-?\b\d{8}\b/g, "");
  n = n.replace(
    /-(?:high|low|mini|nano|pro|preview|beta|alpha|latest|chat|codex|harness|thinking(?:-minimal)?|reasoning|multi-agent|instant|fast|slow|xlarge|xl|sm|m|md|lg)\b/g,
    "",
  );
  n = n.replace(/[\s._/]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return n;
}

async function fetchAlpacaLC(): Promise<{
  data: Map<string, { winrate: number; lcWinrate: number; n: number }>;
  stat: FetchStat;
}> {
  const data = new Map<string, { winrate: number; lcWinrate: number; n: number }>();
  const t0 = performance.now();
  const baseStat = (overrides: Partial<FetchStat> = {}): FetchStat => ({
    url: ALPACA_LC_URL,
    fetched_at: new Date().toISOString(),
    duration_ms: Math.round(performance.now() - t0),
    bytes: 0, sha256: "", ok: false, ...overrides,
  });
  try {
    const res = await fetch(ALPACA_LC_URL, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      console.warn(`[alpaca] failed: HTTP ${res.status}`);
      return { data, stat: baseStat({ error: `HTTP ${res.status}` }) };
    }
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      return { data, stat: baseStat({ bytes: text.length, sha256: sha256(text), ok: false, error: "no rows" }) };
    }

    const header = lines[0].split(",").map((c) => c.trim());
    const lcCol = header.indexOf("length_controlled_winrate");
    const winrateCol = header.indexOf("win_rate");
    const nTotalCol = header.indexOf("n_total");
    if (lcCol < 0) {
      console.warn("[alpaca] missing length_controlled_winrate column");
      return { data, stat: baseStat({ bytes: text.length, sha256: sha256(text), ok: false, error: "missing lc column" }) };
    }

    let count = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const rawKey = (cols[0] ?? "").trim();
      if (!rawKey || cols.length <= lcCol) continue;
      const lc = Number(cols[lcCol]?.trim());
      if (!Number.isFinite(lc) || lc <= 0) continue;
      const wr = winrateCol >= 0 ? Number(cols[winrateCol]) / 100 : lc / 100;
      const n = nTotalCol >= 0 ? Number(cols[nTotalCol]) || 0 : 0;
      data.set(normalizeAlpacaKey(rawKey), { winrate: wr, lcWinrate: lc / 100, n });
      count++;
    }
    console.log(`[alpaca] parsed ${count} entries`);
    return {
      data,
      stat: baseStat({ bytes: text.length, sha256: sha256(text), ok: true }),
    };
  } catch (e) {
    console.warn(`[alpaca] error: ${e}`);
    return { data, stat: baseStat({ error: String(e) }) };
  }
}

export async function buildArenaSupplement(): Promise<{
  arena: ArenaData;
  meta: Record<string, unknown>;
  fetch_stats: FetchStat[];
}> {
  const { data: leaderboards, stats: leaderStats } = await fetchArenaLeaderboards();
  const { data: alpaca, stat: alpacaStat } = await fetchAlpacaLC();

  const result: ArenaData = {};

  // Arena entries
  for (const cat of CATEGORIES) {
    const lb = leaderboards[cat];
    if (!lb) continue;
    const scores = lb.models.map((m) => m.score);
    const minElo = Math.min(...scores);
    const maxElo = Math.max(...scores);
    const eloRange = maxElo - minElo || 1;

    for (const m of lb.models) {
      const score = 0.4 + 0.58 * ((m.score - minElo) / eloRange);
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
        score: Math.round(score * 10000) / 10000,
        confidence,
        categories: CATEGORY_TASK_MAP[cat],
        lastUpdated: lb.meta.last_updated,
        sourceUrl: lb.meta.source_url,
        fetchedAt: lb.meta.fetched_at,
        sources: ["arena"],
      };
    }
  }

  // Alpaca entries (only add if not already present from arena)
  let alpacaOnly = 0;
  for (const [name, data] of alpaca) {
    if (result[name]) {
      // Merge: add alpaca as a second source
      const existing = result[name];
      if (data.lcWinrate > existing.score) {
        existing.score = Math.round(data.lcWinrate * 10000) / 10000;
      }
      if (!existing.sources.includes("alpaca_lc")) {
        existing.sources.push("alpaca_lc");
      }
    } else {
      const confidence: "high" | "medium" | "low" =
        data.n >= HIGH_CONFIDENCE_VOTES ? "high" :
        data.n >= MEDIUM_CONFIDENCE_VOTES ? "medium" : "low";
      result[name] = {
        leaderboard: "text",
        rank: 0,
        elo: 0,
        ci: 0,
        votes: data.n,
        vendor: "",
        license: "",
        score: Math.round(data.lcWinrate * 10000) / 10000,
        confidence,
        categories: CATEGORY_TASK_MAP.text,
        sources: ["alpaca_lc"],
      };
      alpacaOnly++;
    }
  }

  // Also index by version-stripped name for fuzzy matching
  for (const [name, entry] of Object.entries(result)) {
    const stripped = stripVersion(name);
    if (stripped !== name && !result[stripped]) {
      result[stripped] = entry;
    }
  }

  const meta = {
    arena_entries: Object.keys(result).length,
    alpaca_only: alpacaOnly,
    sources: {
      arena: ARENA_BASE,
      alpaca_lc: ALPACA_LC_URL,
    },
    arena_meta: {
      text: leaderboards.text?.meta ?? null,
      code: leaderboards.code?.meta ?? null,
    },
  };

  console.log(`[arena] total: ${Object.keys(result).length} entries (${alpacaOnly} alpaca-only)`);
  return {
    arena: result,
    meta,
    fetch_stats: [
      { name: `arena:${CATEGORIES[0]}`, ...leaderStats.text },
      { name: `arena:${CATEGORIES[1]}`, ...leaderStats.code },
      { name: "alpaca_lc", ...alpacaStat },
    ],
  };
}
