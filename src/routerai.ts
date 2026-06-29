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

export async function buildRouterAISupplement(): Promise<RouterAISupplement & { fetch_stats: FetchStat[] }> {
  const fx = await getUsdRubRate();
  console.log(`[routerai] USD/RUB: ${fx.rate} (${fx.source})`);

  const url = `${ROUTERAI_BASE}/models`;
  const t0 = performance.now();
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const duration_ms = Math.round(performance.now() - t0);

  if (!res.ok) {
    throw new Error(`routerai.ru /models HTTP ${res.status}`);
  }

  const text = await res.text();
  const body = JSON.parse(text) as RawRouterAIModel[] | { data?: RawRouterAIModel[] };
  const catalog = Array.isArray(body) ? body : body.data ?? [];
  const llm = catalog.filter(isLLM);
  console.log(`[routerai] fetched ${catalog.length} models (${llm.length} LLM, ${text.length}B)`);

  const models: Record<string, RouterAIModelEntry> = {};
  let free = 0;

  for (const m of llm) {
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
      input_usd_per_1m: rubPerTokenToUsdPer1M(promptRub, fx.rate),
      output_usd_per_1m: rubPerTokenToUsdPer1M(completionRub, fx.rate),
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

    if (promptRub === 0 && completionRub === 0) free++;
  }

  console.log(`[routerai] ${Object.keys(models).length} models indexed (${free} free)`);

  return {
    currency: { usd_rub: fx.rate, source: fx.source, fetched_at: fx.fetchedAt },
    models,
    meta: {
      model_count: Object.keys(models).length,
      free_count: free,
      source: ROUTERAI_BASE,
      fetched_at: new Date().toISOString(),
    },
    fetch_stats: [
      {
        name: "routerai:models",
        url,
        fetched_at: new Date().toISOString(),
        duration_ms,
        bytes: text.length,
        sha256: sha256(text),
        ok: true,
      },
    ],
  };
}
