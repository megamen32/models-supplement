/**
 * upstream.ts — fetch and flatten the models.dev catalog.
 *
 * models.dev is the base catalog for this project.  Benchmark and provider
 * feeds are deliberately kept separate, but every model emitted by the base
 * catalog is preserved under `models_dev` so consumers do not lose
 * capabilities, limits, modalities, or model metadata when a supplemental
 * feed has no row for that model.
 *
 * The previous generated artifact is a bounded offline fallback.  It is only
 * used after a failed live request and the failed request remains visible in
 * provenance (`fallback: true`); stale data is never presented as live.
 */

import { readFileSync } from "node:fs";
import { sha256, type FetchStat } from "./provenance";

export const MODELS_DEV_URL = "https://models.dev/api.json";

export interface ModelsDevRecord {
  provider_id: string;
  provider_name?: string;
  provider_api?: string;
  provider_doc?: string;
  model: Record<string, unknown>;
}

export interface UpstreamResult {
  models: Record<string, ModelsDevRecord>;
  stat: FetchStat;
  live: boolean;
}

interface ProviderRecord {
  id?: unknown;
  name?: unknown;
  api?: unknown;
  doc?: unknown;
  models?: unknown;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function modelKey(providerId: string, modelKeyFromFeed: string, model: Record<string, unknown>): string {
  // canonical_model_id is the cross-provider identity that models.dev exposes.
  // If absent, an id that already has a vendor prefix is still a complete key;
  // otherwise use the provider namespace, matching models.dev's public shape.
  const canonical = stringOrUndefined(model.canonical_model_id);
  if (canonical?.includes("/")) return canonical;
  const id = stringOrUndefined(model.id) ?? modelKeyFromFeed;
  return id.includes("/") ? id : `${providerId}/${id}`;
}

export function flattenModelsDev(payload: unknown): Record<string, ModelsDevRecord> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const out: Record<string, ModelsDevRecord> = {};
  for (const [providerKey, rawProvider] of Object.entries(payload as Record<string, unknown>)) {
    if (!rawProvider || typeof rawProvider !== "object" || Array.isArray(rawProvider)) continue;
    const provider = rawProvider as ProviderRecord;
    if (!provider.models || typeof provider.models !== "object" || Array.isArray(provider.models)) continue;
    const providerId = stringOrUndefined(provider.id) ?? providerKey;
    for (const [feedKey, rawModel] of Object.entries(provider.models as Record<string, unknown>)) {
      if (!rawModel || typeof rawModel !== "object" || Array.isArray(rawModel)) continue;
      const model = rawModel as Record<string, unknown>;
      const key = modelKey(providerId, feedKey, model);
      out[key] = {
        provider_id: providerId,
        ...(stringOrUndefined(provider.name) ? { provider_name: String(provider.name) } : {}),
        ...(stringOrUndefined(provider.api) ? { provider_api: String(provider.api) } : {}),
        ...(stringOrUndefined(provider.doc) ? { provider_doc: String(provider.doc) } : {}),
        model,
      };
    }
  }
  return out;
}

function statFor(overrides: Partial<FetchStat> = {}): FetchStat {
  return {
    name: "models_dev",
    url: MODELS_DEV_URL,
    fetched_at: new Date().toISOString(),
    duration_ms: 0,
    bytes: 0,
    sha256: "",
    ok: false,
    ...overrides,
  };
}

async function fetchLive(timeoutMs: number): Promise<{ models: Record<string, ModelsDevRecord>; stat: FetchStat }> {
  const started = performance.now();
  try {
    const response = await fetch(MODELS_DEV_URL, {
      headers: { Accept: "application/json", "User-Agent": "models-supplement/1" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    const base = {
      duration_ms: Math.round(performance.now() - started),
      bytes: text.length,
      sha256: sha256(text),
    };
    if (!response.ok) return { models: {}, stat: statFor({ ...base, error: `HTTP ${response.status}` }) };
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { models: {}, stat: statFor({ ...base, error: "invalid JSON" }) };
    }
    const models = flattenModelsDev(payload);
    if (Object.keys(models).length === 0) {
      return { models, stat: statFor({ ...base, error: "catalog contains no models" }) };
    }
    return { models, stat: statFor({ ...base, ok: true }) };
  } catch (error) {
    return {
      models: {},
      stat: statFor({
        duration_ms: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
}

function fallbackFromArtifact(path: string): Record<string, ModelsDevRecord> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { models?: unknown };
    if (!parsed.models || typeof parsed.models !== "object" || Array.isArray(parsed.models)) return {};
    const out: Record<string, ModelsDevRecord> = {};
    for (const [key, value] of Object.entries(parsed.models as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      const upstream = record.models_dev;
      if (!upstream || typeof upstream !== "object" || Array.isArray(upstream)) continue;
      const candidate = upstream as Record<string, unknown>;
      if (typeof candidate.provider_id !== "string" || !candidate.model ||
          typeof candidate.model !== "object" || Array.isArray(candidate.model)) continue;
      out[key] = candidate as unknown as ModelsDevRecord;
    }
    return out;
  } catch {
    return {};
  }
}

/** Fetch models.dev; use the previous generated artifact only on failure. */
export async function fetchModelsDev(
  fallbackPath?: string,
  timeoutMs = 60_000,
): Promise<UpstreamResult> {
  const live = await fetchLive(timeoutMs);
  if (live.stat.ok) return { ...live, live: true };

  const fallback = fallbackPath ? fallbackFromArtifact(fallbackPath) : {};
  if (Object.keys(fallback).length === 0) return { models: {}, stat: live.stat, live: false };
  return {
    models: fallback,
    live: false,
    stat: { ...live.stat, fallback: true, fallback_source: fallbackPath },
  };
}

