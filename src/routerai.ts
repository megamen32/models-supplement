/**
 * routerai.ts — RouterAI (routerai.ru) catalog with RUB pricing.
 * Pure parser + thin fetcher; a failure returns `{ok:false}`, it never throws.
 */

import { getUsdRubRate, rubPerTokenToUsdPer1M } from "./currency";
import { canonicalId } from "./canonical";
import type { RouterAIModelEntry } from "./build-types";
import { failedResult, fetchText, type Contribution, type SourceResult } from "./source";

export const ROUTERAI_URL = "https://routerai.ru/api/v1/models";

interface RawModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number | null;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: { prompt?: number; completion?: number };
  supported_parameters?: string[];
}

function isLLM(m: RawModel): boolean {
  const out = m.architecture?.output_modalities ?? [];
  return out.includes("text") && !out.includes("video") && !out.includes("image");
}

export function parseRouterAI(text: string, usdRub: number): SourceResult {
  let body: RawModel[] | { data?: RawModel[] };
  try { body = JSON.parse(text); } catch { return failedResult("not JSON"); }
  const catalog = Array.isArray(body) ? body : body?.data;
  if (!Array.isArray(catalog)) return failedResult("no model list");

  // Shortest raw id first: when a dated id collapses onto an undated one, the undated wins.
  const llm = catalog.filter((m) => m && typeof m.id === "string" && isLLM(m)).sort((a, b) => a.id.length - b.id.length);
  const records: Contribution[] = [];
  for (const m of llm) {
    const slash = m.id.indexOf("/");
    const id = slash < 0 ? canonicalId(null, m.id) : canonicalId(m.id.slice(0, slash), m.id.slice(slash + 1));
    if (!id) continue;
    const promptRub = m.pricing?.prompt ?? 0;
    const completionRub = m.pricing?.completion ?? 0;
    const inp = m.architecture?.input_modalities ?? [];
    const params = m.supported_parameters ?? [];
    const lid = m.id.toLowerCase();
    const value: RouterAIModelEntry = {
      id: m.id,
      name: m.name,
      description: m.description?.slice(0, 300),
      context_length: m.context_length ?? undefined,
      input_rub_per_token: promptRub,
      output_rub_per_token: completionRub,
      input_usd_per_1m: rubPerTokenToUsdPer1M(promptRub, usdRub),
      output_usd_per_1m: rubPerTokenToUsdPer1M(completionRub, usdRub),
      supports_vision: inp.includes("image"),
      supports_tools: params.includes("tools") || params.includes("tool_choice"),
      supports_structured_output:
        params.includes("response_format") || params.includes("structured_outputs") || params.includes("json_schema"),
      reasoning:
        lid.includes("thinking") || lid.includes("reasoning") ||
        params.includes("reasoning_effort") || params.includes("thinking_budget"),
    };
    records.push({ id, field: "routerai", value, display_name: m.name });
  }
  return { ok: true, records };
}

export async function fetchRouterAI(): Promise<SourceResult> {
  try {
    const fx = await getUsdRubRate();
    if (fx.source.startsWith("fallback")) return failedResult("no live USD/RUB rate");
    const { text, stat } = await fetchText("routerai", ROUTERAI_URL, { headers: { Accept: "application/json" } });
    if (text === undefined) return failedResult(stat.error ?? "fetch failed", stat);
    const r = parseRouterAI(text, fx.rate);
    return {
      ...r,
      stat: r.ok ? stat : { ...stat, ok: false, error: r.error },
      meta: { currency: { usd_rub: fx.rate, source: fx.source, fetched_at: fx.fetchedAt } },
    };
  } catch (e) {
    return failedResult(String(e));
  }
}
