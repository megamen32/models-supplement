/**
 * normalize.ts — Shared model-name normalization across all sources.
 *
 * Why: arena, alpaca, HLE (CAIS dashboard) and SWE-bench each use different
 * conventions for the same model:
 *   - arena:       "anthropic/claude-opus-4-6-thinking"
 *   - alpaca:      "anthropic--claude-opus-4-6-20250822"
 *   - HLE:         "Opus 4.6"
 *   - SWE-bench:   "mini-SWE-agent + Claude Opus 4.6 (high reasoning)"
 *
 * Goal: produce a stable key that lets consumers look up one model across
 * all sources. Original raw_name is preserved for debugging.
 *
 * Rules (applied in order):
 *   1. Strip "mini-SWE-agent +" prefix
 *   2. Strip vendor prefixes (anthropic/, meta-llama/, openai/, …)
 *   3. Drop parenthesized annotations ((high reasoning), (2025-08-22))
 *   4. Lowercase, collapse spaces/underscores/slashes to single dashes
 *   5. Drop ISO dates (YYYY-MM-DD) and 8-digit YYYYMMDD
 *   6. Trim leading/trailing dashes
 *
 * Deliberately NOT stripped (to preserve model identity):
 *   -thinking, -codex, -pro, -mini, -nano, -high, -low, etc.
 * Consumers wanting fuzzy matching can apply their own aliasing on top.
 */

const VENDOR_PREFIXES = [
  // lowercase + uppercase variants
  "anthropic/", "openai/", "google/", "meta-llama/", "meta/",
  "mistral/", "deepseek/", "xai/", "cohere/", "qwen/", "alibaba/",
  "nvidia/", "01-ai/", "phind/", "zerox/", "together/", "fireworks/",
  "perplexity/", "ai21/", "moonshotai/", "zhipuai/", "xiaomi/",
  "z-ai/", "NousResearch/", "HuggingFaceH4/", "lmsys/",
];

// SWE-bench leaderboard wraps every model with a scaffolding prefix.
// We strip known scaffold patterns because consumers want the model, not the agent.
const SCAFFOLD_PATTERNS: RegExp[] = [
  /^(?:live|mini|full|auto|sweagent|comb)[-\s]?swe[-\s]?agent\s*\+\s*/i,
  /^swe[\s_-]?agent\s*\+\s*/i,
];

export function normalizeModelName(raw: string): string {
  let n = raw.trim();

  // 1. Strip scaffolding prefix (try multiple patterns)
  for (const pat of SCAFFOLD_PATTERNS) {
    n = n.replace(pat, "");
  }

  // 2. Strip vendor prefixes (case-insensitive)
  const lower = n.toLowerCase();
  for (const p of VENDOR_PREFIXES) {
    if (lower.startsWith(p.toLowerCase())) {
      n = n.slice(p.length);
      break;
    }
  }

  // 3. Drop parenthesized annotations: "(2025-08-22)", "(high reasoning)", "(Max)"
  n = n.replace(/\s*\([^)]*\)\s*/g, " ");

  // 4. Lowercase + collapse whitespace/underscores/slashes/dots to dashes
  n = n.toLowerCase()
    .replace(/[\s._/]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // 5. Drop ISO dates (already collapsed into the dashed string)
  n = n.replace(/-\d{4}-\d{2}-\d{2}/g, "");
  n = n.replace(/-\d{8}/g, "");

  // 6. Trim
  n = n.replace(/^-|-$/g, "");
  return n;
}

/** Extract a base "family" key that ignores version qualifiers (-thinking, -preview).
 *  Useful when consumers want to group all variants of a model family. */
export function familyKey(raw: string): string {
  return normalizeModelName(raw)
    .replace(/-thinking(?:-minimal)?$/, "")
    .replace(/-(preview|beta|alpha|latest|codex|experimental)$/, "");
}