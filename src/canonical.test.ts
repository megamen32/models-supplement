import { expect, test } from "bun:test";
import { canonicalId } from "./canonical";
import { normalizeModelName } from "./normalize";

test("version numbers keep the dot, dash forms collapse to it", () => {
  expect(canonicalId("anthropic", "claude-opus-5.5")).toBe("anthropic/claude-opus-5.5");
  expect(canonicalId("anthropic", "claude-opus-5-5")).toBe("anthropic/claude-opus-5.5");
  expect(canonicalId("openai", "gpt-5-4-nano")).toBe("openai/gpt-5.4-nano");
  expect(canonicalId("moonshotai", "kimi-k2-6")).toBe("moonshotai/kimi-k2.6");
  expect(canonicalId("google", "gemini-2-5-flash-lite")).toBe("google/gemini-2.5-flash-lite");
});

test("sizes and dates are not mistaken for versions", () => {
  expect(canonicalId("meta-llama", "llama-3-8b-instruct")).toBe("meta-llama/llama-3-8b-instruct");
  expect(canonicalId("deepseek", "deepseek-r1-0528")).toBe("deepseek/deepseek-r1-0528");
  expect(canonicalId("anthropic", "claude-3-5-sonnet-20241022")).toBe("anthropic/claude-3.5-sonnet");
  expect(canonicalId("openai", "gpt-4o-2024-08-06")).toBe("openai/gpt-4o");
});

test("vendor aliases map to one vendor", () => {
  expect(canonicalId("xai", "grok-4-3")).toBe("x-ai/grok-4.3");
  expect(canonicalId("x-ai", "grok-4.3")).toBe("x-ai/grok-4.3");
  expect(canonicalId("meta", "muse-spark-1.1")).toBe("meta-llama/muse-spark-1.1");
  expect(canonicalId("muse", "muse-spark-1-1")).toBe("meta-llama/muse-spark-1.1");
  expect(canonicalId("zhipu", "glm-5-1")).toBe("z-ai/glm-5.1");
  expect(canonicalId("mistral", "mistral-large")).toBe("mistralai/mistral-large");
  expect(canonicalId("rekaai", "reka-edge")).toBe("reka/reka-edge");
  expect(canonicalId("MiniMax", "minimax-m2-5")).toBe("minimax/minimax-m2.5");
});

test("moving ~latest aliases are dropped", () => {
  expect(canonicalId("~anthropic", "claude-fable-latest")).toBeNull();
  expect(canonicalId("anthropic", "~claude-opus-latest")).toBeNull();
});

test("anthropic family names are normalized to claude-<family>-<version>", () => {
  expect(canonicalId("anthropic", "opus-4-6")).toBe("anthropic/claude-opus-4.6");
  expect(canonicalId("anthropic", "fable-5")).toBe("anthropic/claude-fable-5");
  expect(canonicalId(null, "claude-4-5-opus-medium")).toBe("anthropic/claude-opus-4.5-medium");
  expect(canonicalId(null, "claude-4-sonnet")).toBe("anthropic/claude-sonnet-4");
  expect(canonicalId(null, "claude-3-7-sonnet")).toBe("anthropic/claude-3.7-sonnet");
});

test("unknown vendor is inferred from the model family, or null", () => {
  expect(canonicalId("unknown", "gpt-4o")).toBe("openai/gpt-4o");
  expect(canonicalId(null, "grok-4-1-fast")).toBe("x-ai/grok-4.1-fast");
  expect(canonicalId(null, "nullmodel")).toBeNull();
});

test("normalizeModelName keeps dots so canonicalId can see versions", () => {
  expect(normalizeModelName("mini-SWE-agent + Claude Opus 4.6 (high reasoning)")).toBe("claude-opus-4.6");
});
