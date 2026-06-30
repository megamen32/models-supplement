/**
 * canonical.ts — Map source-specific model identifiers to canonical
 * `vendor/name` form (the same shape models.dev uses).
 *
 * Why: HLE gives "Opus 4.6", arena gives "claude-opus-4-6", SWE-bench gives
 * "claude-4-5-opus-medium". All three refer to Anthropic Claude variants.
 * A consumer of supplement.json should be able to do
 *   supplement.models["anthropic/claude-opus-4-6"]
 * and get a single merged record with arena, hle, swebench data combined.
 *
 * Sources of vendor info, in priority order:
 *   1. Explicit field: HLE API gives `provider` per model — use it.
 *   2. arena entries have `vendor` field — use it.
 *   3. SWE-bench has no vendor field — infer from model family prefix
 *      (claude/gpt/gemini/etc). Unknown families go to `unmatched_display_names`.
 *   4. routerai keys are already `vendor/name` — split on first `/`.
 */

import { normalizeModelName } from "./normalize";

/**
 * Normalize model name for canonical form, given the vendor.
 *   - anthropic: ensure "claude-" prefix (HLE drops it, arena keeps it)
 *   - others: passthrough
 */
export function canonicalizeNameForVendor(name: string, vendor: string): string {
  if (vendor === "anthropic") {
    if (/^(opus|sonnet|haiku|opus-4|sonnet-4|haiku-4|opus-3|sonnet-3|haiku-3)/.test(name)) {
      return `claude-${name}`;
    }
  }
  return name;
}

/** Vendor inference for normalized model names (lower-case, dash-separated). */
const FAMILY_TO_VENDOR: Array<[RegExp, string]> = [
  [/^(claude|opus|sonnet|haiku)/, "anthropic"],
  [/^(gpt|o[1-9](-|$))/, "openai"],
  [/^gemini/, "google"],
  [/^grok/, "xai"],
  [/^deepseek/, "deepseek"],
  [/^kimi/, "moonshotai"],
  [/^glm/, "z-ai"],
  [/^qwen/, "qwen"],
  [/^llama/, "meta"],
  [/^mistral/, "mistral"],
  [/^minimax-?m/, "MiniMax"],   // us!
  [/^mai-/, "microsoft"],
  [/^nemotron/, "nvidia"],
  [/^zaya/, "zyphra"],
  [/^ornith/, "deepreinforce"],
  [/^laguna/, "poolside"],
  [/^hy3/, "tencent"],
  [/^doubao-/, "bytedance"],
  [/^hunyuan/, "tencent"],
  [/^sonar/, "perplexity"],      // Sonar is Perplexity's model
  [/^lingxi/, "alibaba"],
];

const PROVIDER_NORMALIZE: Record<string, string> = {
  anthropic: "anthropic", openai: "openai", google: "google", deepmind: "google",
  meta: "meta", mistral: "mistral", deepseek: "deepseek", xai: "xai", cohere: "cohere",
  qwen: "qwen", alibaba: "qwen", nvidia: "nvidia", moonshotai: "moonshotai",
  moonshot: "moonshotai", zhipuai: "zhipuai", xiaomi: "xiaomi",
  "z-ai": "z-ai", "z.ai": "z-ai", "zai": "z-ai",
  "01-ai": "01-ai", "01ai": "01-ai",
  perplexity: "perplexity", minimax: "MiniMax", microsoft: "microsoft", bytedance: "bytedance",
  tencent: "tencent", poolside: "poolside", deepreinforce: "deepreinforce",
  zyphra: "zyphra",
};

/** Infer canonical `<vendor>/<model>` from a normalized lower-case model name. */
export function inferCanonicalFromName(normName: string): string | null {
  for (const [re, vendor] of FAMILY_TO_VENDOR) {
    if (re.test(normName)) {
      return `${vendor}/${normName}`;
    }
  }
  return null;
}

/** HLE: trust the API's `provider` field. Falls back to name inference. */
export function hleToCanonical(normName: string, provider?: string): string | null {
  if (provider) {
    const v = PROVIDER_NORMALIZE[provider.toLowerCase().trim()] ?? provider.toLowerCase().trim();
    const normalized = canonicalizeNameForVendor(normName, v);
    return `${v}/${normalized}`;
  }
  return inferCanonicalFromName(normName);
}

/** SWE-bench: no vendor field — name inference only, with anthropic normalization. */
export function sweKeyToCanonical(normName: string): string | null {
  const inferred = inferCanonicalFromName(normName);
  if (!inferred) return null;
  const slash = inferred.indexOf("/");
  const vendor = inferred.slice(0, slash);
  const name = inferred.slice(slash + 1);
  return `${vendor}/${canonicalizeNameForVendor(name, vendor)}`;
}

/** arena: arena keys are vendor-stripped, but the entry carries `vendor`. */
export function arenaKeyToCanonical(arenaKey: string, vendor: string): string {
  const v = PROVIDER_NORMALIZE[vendor.toLowerCase().trim()] ?? vendor.toLowerCase().trim();
  return `${v}/${arenaKey}`;
}

/** routerai: keys are already `vendor/name` — split on first `/`. */
export function routeraiKeyToCanonical(routeraiKey: string): string {
  const slash = routeraiKey.indexOf("/");
  if (slash < 0) {
    // Defensive: no vendor prefix — infer
    const inferred = inferCanonicalFromName(routeraiKey);
    return inferred ?? `unknown/${routeraiKey}`;
  }
  const vendorRaw = routeraiKey.slice(0, slash).toLowerCase();
  const vendor = PROVIDER_NORMALIZE[vendorRaw] ?? vendorRaw;
  const name = routeraiKey.slice(slash + 1);
  return `${vendor}/${name}`;
}

/** Best-effort display name for a model (used in supplement entry). */
export function displayNameFromRaw(raw: string): string {
  // Strip common scaffolding suffixes for human readability
  return raw
    .replace(/^.*?\+\s*/, "")              // "X + Claude 4.5 Opus" → "Claude 4.5 Opus"
    .replace(/\s*\([^)]*\)\s*$/, "")        // "Foo (2025-08-22)" → "Foo"
    .trim();
}

/** Convenience: normalize a raw model name from any source. */
export function normalize(raw: string): string {
  return normalizeModelName(raw);
}