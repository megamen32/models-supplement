/**
 * routerai.ts — Fetch RouterAI (routerai.ru) model catalog.
 *
 * RouterAI is a Russian LLM aggregator that prices in RUB per token.
 * We fetch the live catalog, keep RUB pricing as-is, and also compute
 * USD/1M equivalents using the current CBR rate.
 *
 * Output: a lookup keyed by model id with both RUB and USD pricing +
 * capability flags (vision, tools, structured_output, reasoning).
 */

import { getUsdRubRate } from "./currency";
import { sha256, type FetchStat } from "./provenance";
import { firstError, type SourceResult } from "./source";

const ROUTERAI_BASE = "https://routerai.ru/api/v1";

export interface RouterAIModelEntry {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  input_rub_per_token: number;
  output_rub_per_token: number;
  input_usd_per_1m: number;
  output_usd_per_1m: number;
  supports_vision: boolean;
  supports_tools: boolean;
  supports_structured_output: boolean;
  reasoning: boolean;
}

export interface RouterAISupplement {
  currency: { usd_rub: number; source: string; fetched_at: string };
  models: Record<string, RouterAIModelEntry>;
  meta: Record<string, unknown>;
}

interface RawRouterAIModel {
  id: string;
  name?: string;
  description?: string;
  created?: number;
  context_length?: number | null;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: { prompt?: number; completion?: number };
  supported_parameters?: string[];
}

function rubPerTokenToUsdPer1M(rubPerToken: number, usdRub: number): number {
  if (!rubPerToken || rubPerToken <= 0) return 0;
  return Math.round(((rubPerToken * 1_000_000) / usdRub) * 10000) / 10000;
}

function isLLM(m: RawRouterAIModel): boolean {
  const out = m.architecture?.output_modalities ?? [];
  return out.includes("text") && !out.includes("video") && !out.includes("image");
}

/** Pure: raw catalog -> RouterAI entries (LLMs only) with USD/1M computed at `usdRub`. */
export function parseRouterAICatalog(catalog: RawRouterAIModel[], usdRub: number): Record<string, RouterAIModelEntry> {
  const models: Record<string, RouterAIModelEntry> = {};
  for (const m of catalog.filter(isLLM)) {
    const promptRub = m.pricing?.prompt ?? 0;
    const completionRub = m.pricing?.completion ?? 0;
    const inp = m.architecture?.input_modalities ?? [];
    const params = m.supported_parameters ?? [];
    const id = m.id.toLowerCase();
    models[m.id] = {
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
        params.includes("response_format") ||
        params.includes("structured_outputs") ||
        params.includes("json_schema"),
      reasoning:
        id.includes("thinking") || id.includes("reasoning") ||
        params.includes("reasoning_effort") || params.includes("thinking_budget"),
    };
  }
  return models;
}

export interface RouterAIRecords {
  models: Record<string, RouterAIModelEntry>;
  currency: { usd_rub: number; source: string; fetched_at: string } | null;
}

/** Thin fetch. Never throws: a failure is {ok:false, error}. */
export async function fetchRouterAI(): Promise<SourceResult<RouterAIRecords>> {
  const url = `${ROUTERAI_BASE}/models`;
  const t0 = performance.now();
  const fail = (error: string, bytes = 0, hash = ""): SourceResult<RouterAIRecords> => {
    const stat: FetchStat = {
      name: "routerai:models", url, fetched_at: new Date().toISOString(),
      duration_ms: Math.round(performance.now() - t0), bytes, sha256: hash, ok: false, error,
    };
    return { ok: false, records: { models: {}, currency: null }, error: firstError([stat]), stats: [stat] };
  };
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return fail(`HTTP ${res.status}`);
    const text = await res.text();
    const body = JSON.parse(text) as RawRouterAIModel[] | { data?: RawRouterAIModel[] };
    const catalog = Array.isArray(body) ? body : body.data ?? [];
    const fx = await getUsdRubRate();
    const models = parseRouterAICatalog(catalog, fx.rate);
    if (Object.keys(models).length === 0) return fail("catalog contains no LLM models", text.length, sha256(text));
    console.log(`[routerai] ${Object.keys(models).length} LLM models of ${catalog.length} (USD/RUB ${fx.rate}, ${fx.source})`);
    const stat: FetchStat = {
      name: "routerai:models", url, fetched_at: new Date().toISOString(),
      duration_ms: Math.round(performance.now() - t0), bytes: text.length, sha256: sha256(text), ok: true,
    };
    return {
      ok: true,
      records: { models, currency: { usd_rub: fx.rate, source: fx.source, fetched_at: fx.fetchedAt } },
      stats: [stat],
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
