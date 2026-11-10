/**
 * canonical.ts — the ONE place that turns (vendor, model name) from any
 * source into a canonical `vendor/name` id.
 *
 * Rules:
 *   - vendor: lower-case, run through VENDOR_ALIASES (xai→x-ai, meta→meta-llama, …).
 *     Missing/"unknown" vendor is inferred from the model family; no match → null.
 *   - name: lower-case, dates dropped, separators collapsed to "-", version
 *     numbers keep the dot ("claude-opus-4.6", never "4-6").
 *   - moving aliases (`~anthropic/claude-opus-latest`) are not models → null.
 *
 * All functions are pure.
 */

const VENDOR_ALIASES: Record<string, string> = {
  xai: "x-ai", "x.ai": "x-ai",
  meta: "meta-llama", muse: "meta-llama",
  zhipu: "z-ai", zhipuai: "z-ai", zai: "z-ai", "z.ai": "z-ai",
  mistral: "mistralai",
  rekaai: "reka",
  alibaba: "qwen",
  deepmind: "google",
  moonshot: "moonshotai",
  "01ai": "01-ai",
  "bytedance-seed": "bytedance",
};

/** Vendor inference for a canonical-style model name (lower-case, dashed). */
const FAMILY_TO_VENDOR: Array<[RegExp, string]> = [
  [/^(claude|opus|sonnet|haiku|fable)/, "anthropic"],
  [/^(gpt|o[1-9](-|$))/, "openai"],
  [/^(gemini|gemma)/, "google"],
  [/^grok/, "x-ai"],
  [/^deepseek/, "deepseek"],
  [/^kimi/, "moonshotai"],
  [/^glm/, "z-ai"],
  [/^qwen/, "qwen"],
  [/^(llama|muse-)/, "meta-llama"],
  [/^mistral/, "mistralai"],
  [/^minimax-?m/, "minimax"],
  [/^mai-/, "microsoft"],
  [/^nemotron/, "nvidia"],
  [/^zaya/, "zyphra"],
  [/^ornith/, "deepreinforce"],
  [/^laguna/, "poolside"],
  [/^(hy3|hunyuan)/, "tencent"],
  [/^doubao-/, "bytedance"],
  [/^sonar/, "perplexity"],
];

export function canonicalVendor(vendor: string): string {
  const v = vendor.toLowerCase().trim();
  return VENDOR_ALIASES[v] ?? v;
}

/** Restore "4-6" → "4.6" between single digits; leave sizes ("3-8b") and dates alone. */
function restoreDots(n: string): string {
  return n.replace(/(?<![\d.])(\d)-(\d)(?!\d|[bmk](?:-|$))/g, "$1.$2");
}

/** Lower-case dashed name with dates dropped and versions dotted. Not vendor-aware. */
export function cleanName(raw: string): string {
  let n = raw.toLowerCase().trim();
  n = n.replace(/\(\s*[\d-]+\s*\)/g, " ");        // "(2025-08-22)"
  n = n.replace(/[()]/g, " ");                      // "glm-5.2 (max)" → "glm-5.2 max"
  n = n.replace(/[\s_/]+/g, "-").replace(/-+/g, "-");
  n = n.replace(/-\d{4}-\d{2}-\d{2}/g, "").replace(/-\d{8}\b/g, "");
  n = n.replace(/^-|-$/g, "");
  return restoreDots(n);
}

function fixAnthropic(n: string): string {
  if (/^(opus|sonnet|haiku|fable)(-|$)/.test(n)) n = `claude-${n}`;
  // claude-4-opus / claude-4.5-opus-medium → claude-opus-4 / claude-opus-4.5-medium (v4+ naming)
  return n.replace(/^claude-([4-9](?:\.\d)?)-(opus|sonnet|haiku|fable)/, "claude-$2-$1");
}

function fixDeepseek(n: string): string {
  return n.replace(/^deepseek-(\d)/, "deepseek-v$1");
}

export function inferVendor(name: string): string | null {
  const n = cleanName(name);
  for (const [re, vendor] of FAMILY_TO_VENDOR) if (re.test(n)) return vendor;
  return null;
}

/** The single entry point: `vendor/name`, or null when the model cannot be identified. */
export function canonicalId(vendor: string | null | undefined, name: string): string | null {
  const v0 = (vendor ?? "").trim();
  if (v0.startsWith("~") || name.trim().startsWith("~")) return null;
  const n0 = cleanName(name);
  if (!n0) return null;
  const v = v0 && v0.toLowerCase() !== "unknown" ? canonicalVendor(v0) : inferVendor(n0);
  if (!v) return null;
  let n = n0;
  if (v === "anthropic") n = fixAnthropic(n);
  if (v === "deepseek") n = fixDeepseek(n);
  return `${v}/${n}`;
}

/** Best-effort display name for a model (strip scaffold prefix and trailing parenthesis). */
export function displayNameFromRaw(raw: string): string {
  return raw
    .replace(/^.*?\+\s*/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}
