/**
 * scores.ts — benchmark scores from two official JSON endpoints.
 *
 *   cais:       HLE + SWE-bench Pro (CAIS dashboard, one request)
 *   swe_bench:  SWE-bench Verified / Lite / Multilingual (official leaderboards.json)
 *
 * Pure parsers; display names are resolved through resolveDisplayName().
 */

import { normalizeModelName } from "./normalize";
import { displayNameFromRaw, resolveDisplayName } from "./canonical";
import { failedResult, runSource, type Contribution, type SourceResult, type UnmatchedItem } from "./source";

export const HLE_URL = "https://dashboard.safe.ai/api/models";
// Match the public lastexam.ai client for this cross-origin API (generic requests get 403).
export const HLE_HEADERS = {
  Origin: "https://lastexam.ai",
  Referer: "https://lastexam.ai/",
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0",
};
export const SWE_URL =
  "https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json";

interface HleModel {
  name: string;
  provider?: string;
  releaseDate?: string;
  scores?: Record<string, number | null | undefined>;
}

const pct = (x: number) => Math.round((x / 100) * 10000) / 10000;

export function parseCais(text: string): SourceResult {
  let models: HleModel[];
  try { models = JSON.parse(text); } catch { return failedResult("not JSON"); }
  if (!Array.isArray(models)) return failedResult("not an array");

  const records: Contribution[] = [];
  const unmatched: UnmatchedItem[] = [];
  for (const m of models) {
    if (!m?.name || !m.scores) continue;
    const res = resolveDisplayName(m.name, m.provider);
    const wants: Array<[string, unknown]> = [];
    const hle = m.scores.hle;
    if (typeof hle === "number" && hle >= 0) {
      wants.push(["hle", {
        score: pct(hle), raw_score: hle, date: m.releaseDate,
        calibration_error: m.scores.hle_calibration_error ?? null, provider: m.provider ?? undefined,
      }]);
    }
    const pro = m.scores.swebench_pro;
    if (typeof pro === "number" && pro >= 0) wants.push(["swebench_pro", { score: pct(pro), raw_score: pro, date: m.releaseDate }]);
    for (const [field, value] of wants) {
      if (res.id) records.push({ id: res.id, field, value, display_name: displayNameFromRaw(m.name) });
      else unmatched.push({ field, display_name: m.name, reason: "unknown_vendor", kind: res.kind });
    }
  }
  return { ok: true, records, unmatched };
}

const SWE_SPLITS: Record<string, string> = {
  verified: "swe_bench_verified", lite: "swe_bench_lite", multilingual: "swe_bench_multilingual",
};

interface SweResult { name: string; resolved?: number; date?: string }

export function parseSwe(text: string): SourceResult {
  let body: { leaderboards?: Array<{ name: string; results?: SweResult[] }> };
  try { body = JSON.parse(text); } catch { return failedResult("not JSON"); }
  if (!Array.isArray(body?.leaderboards)) return failedResult("no leaderboards");

  const best = new Map<string, Contribution & { date: string }>();
  const unmatched: UnmatchedItem[] = [];
  for (const lb of body.leaderboards) {
    const field = SWE_SPLITS[lb.name?.toLowerCase()];
    if (!field) continue;
    for (const r of lb.results ?? []) {
      if (typeof r.resolved !== "number" || r.resolved < 0) continue;
      const res = resolveDisplayName(normalizeModelName(r.name) || r.name, undefined, r.name);
      if (!res.id) {
        unmatched.push({ field, display_name: r.name, reason: "unknown_vendor", kind: res.kind });
        continue;
      }
      const key = `${field}|${res.id}`;
      const date = r.date ?? "";
      const prev = best.get(key);
      // Several runs per model: keep the most recent; on equal dates the higher score.
      if (!prev || prev.date < date || (prev.date === date && (prev.value as { raw_score: number }).raw_score < r.resolved)) {
        best.set(key, {
          id: res.id, field, date, display_name: displayNameFromRaw(r.name),
          value: { score: pct(r.resolved), raw_score: r.resolved, date: r.date },
        });
      }
    }
  }
  return { ok: true, records: [...best.values()].map(({ date: _d, ...c }) => c), unmatched };
}

export const fetchCais = () => runSource("cais", HLE_URL, parseCais, { headers: HLE_HEADERS });
export const fetchSwe = () => runSource("swe_bench", SWE_URL, parseSwe, { timeoutMs: 60_000 });
