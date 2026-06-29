/**
 * scores.ts — Fetch benchmark scores from authoritative JSON endpoints.
 *
 * Two sources, both official:
 *   1. HLE (Humanity's Last Exam) — CAIS Dashboard, https://dashboard.safe.ai/api/models
 *      Single endpoint returns ~80 models with hle, swebench_pro,
 *      hle_calibration_error fields. Same org that created HLE.
 *
 *   2. SWE-bench — Official leaderboard JSON, raw GitHub
 *      https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json
 *      Single file (~7 MB) contains all splits: verified, lite, multilingual,
 *      multimodal, bash-only, test.
 *
 * Each fetcher returns:
 *   { data: { [normalizedModelName]: ScoreEntry }, stat: FetchStat }
 *
 * Where ScoreEntry preserves raw_name + raw_score (so consumers can verify
 * provenance) and exposes score in [0, 1].
 */

import { sha256, type FetchStat } from "./provenance";
import { normalizeModelName } from "./normalize";

export interface ScoreEntry {
  raw_name: string;
  score: number;          // normalized 0..1
  raw_score: number;      // original (e.g., 38.4 for 38.4%)
  date?: string;
  sources: string[];
  extras?: Record<string, unknown>;
}

const HLE_API = "https://dashboard.safe.ai/api/models";
const SWE_LEADERBOARD_URL =
  "https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json";

interface HleModel {
  name: string;
  id?: string;
  provider?: string;
  releaseDate?: string;
  scores?: Record<string, number | null | undefined>;
  modelCardUrl?: string;
}

async function fetchJson<T>(url: string, timeoutMs = 30_000): Promise<{ data: T; stat: FetchStat }> {
  const t0 = performance.now();
  const fetched_at = new Date().toISOString();
  const baseStat = (overrides: Partial<FetchStat> = {}): FetchStat => ({
    name: url,
    url, fetched_at,
    duration_ms: Math.round(performance.now() - t0),
    bytes: 0, sha256: "", ok: false, ...overrides,
  });
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { data: undefined as unknown as T, stat: baseStat({ error: `HTTP ${res.status}` }) };
    const text = await res.text();
    const data = JSON.parse(text) as T;
    return {
      data,
      stat: baseStat({ bytes: text.length, sha256: sha256(text), ok: true }),
    };
  } catch (e) {
    return { data: undefined as unknown as T, stat: baseStat({ error: String(e) }) };
  }
}

/** Fetch HLE + SWE-bench Pro from CAIS Dashboard. */
export async function fetchHLE(): Promise<{
  hle: Record<string, ScoreEntry>;
  swebench_pro: Record<string, ScoreEntry>;
  stat: FetchStat;
}> {
  const { data: models, stat } = await fetchJson<HleModel[]>(HLE_API);

  const hle: Record<string, ScoreEntry> = {};
  const swebenchPro: Record<string, ScoreEntry> = {};

  if (!Array.isArray(models)) {
    return { hle, swebench_pro: swebenchPro, stat: { ...stat, name: "hle_api", ok: false, error: stat.error ?? "not array" } };
  }

  for (const m of models) {
    if (!m?.name || !m.scores) continue;
    const normKey = normalizeModelName(m.name);

    const hleScore = m.scores.hle;
    if (typeof hleScore === "number" && hleScore >= 0) {
      hle[normKey] = {
        raw_name: m.name,
        score: Math.round(hleScore / 100 * 10000) / 10000,
        raw_score: hleScore,
        date: m.releaseDate,
        sources: ["hle"],
        extras: {
          calibration_error: m.scores.hle_calibration_error ?? null,
          model_id: m.id ?? null,
          provider: m.provider ?? null,
        },
      };
    }

    const swePro = m.scores.swebench_pro;
    if (typeof swePro === "number" && swePro >= 0) {
      swebenchPro[normKey] = {
        raw_name: m.name,
        score: Math.round(swePro / 100 * 10000) / 10000,
        raw_score: swePro,
        date: m.releaseDate,
        sources: ["swe_bench_pro"],
      };
    }
  }

  return {
    hle,
    swebench_pro: swebenchPro,
    stat: { ...stat, name: "cais_dashboard", ok: stat.ok },
  };
}

interface SweLeaderboard {
  name: string;
  results: SweResult[];
}
interface SweResult {
  name: string;
  resolved?: number;
  date?: string;
  folder?: string;
}

/** Fetch SWE-bench Verified + Lite + Multilingual from official leaderboard JSON. */
export async function fetchSWEbench(): Promise<{
  swe_bench_verified: Record<string, ScoreEntry>;
  swe_bench_lite: Record<string, ScoreEntry>;
  swe_bench_multilingual: Record<string, ScoreEntry>;
  stats: FetchStat[];
}> {
  const { data, stat } = await fetchJson<{ leaderboards: SweLeaderboard[] }>(SWE_LEADERBOARD_URL, 60_000);
  const stats: FetchStat[] = [{ ...stat, name: "swe_bench_leaderboard" }];

  const out = {
    swe_bench_verified: {} as Record<string, ScoreEntry>,
    swe_bench_lite: {} as Record<string, ScoreEntry>,
    swe_bench_multilingual: {} as Record<string, ScoreEntry>,
  };

  if (!data?.leaderboards) return { ...out, stats };

  // Prefer the most recent entry per (model, split). SWE-bench often has
  // multiple rows for the same model (different runs / scaffolds).
  const map: Record<keyof typeof out, Map<string, ScoreEntry>> = {
    swe_bench_verified: new Map(),
    swe_bench_lite: new Map(),
    swe_bench_multilingual: new Map(),
  };

  for (const lb of data.leaderboards) {
    const splitName = lb.name.toLowerCase();
    let target: keyof typeof out | null = null;
    let sourceTag: string | null = null;
    if (splitName === "verified") { target = "swe_bench_verified"; sourceTag = "swe_bench_verified"; }
    else if (splitName === "lite") { target = "swe_bench_lite"; sourceTag = "swe_bench_lite"; }
    else if (splitName === "multilingual") { target = "swe_bench_multilingual"; sourceTag = "swe_bench_multilingual"; }
    if (!target || !sourceTag) continue;

    for (const r of lb.results ?? []) {
      if (typeof r.resolved !== "number" || r.resolved < 0) continue;
      const key = normalizeModelName(r.name);
      const entry: ScoreEntry = {
        raw_name: r.name,
        score: Math.round(r.resolved / 100 * 10000) / 10000,
        raw_score: r.resolved,
        date: r.date,
        sources: [sourceTag],
      };
      const existing = map[target].get(key);
      if (!existing || (existing.date ?? "") < (r.date ?? "")) {
        map[target].set(key, entry);
      }
    }
  }

  for (const k of Object.keys(map) as (keyof typeof out)[]) {
    out[k] = Object.fromEntries(map[k]);
  }

  return { ...out, stats };
}