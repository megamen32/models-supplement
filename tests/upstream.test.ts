import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchModelsDev, flattenModelsDev } from "../src/upstream";

describe("models.dev upstream catalog", () => {
  test("flattens provider models using canonical ids when available", () => {
    const result = flattenModelsDev({
      anthropic: {
        id: "anthropic",
        name: "Anthropic",
        models: {
          "claude-opus-5-2": {
            id: "claude-opus-5-2",
            name: "Claude Opus 5.2",
            tool_call: true,
          },
        },
      },
      zai: {
        id: "zai",
        name: "Z.AI",
        models: {
          "glm-5-3": {
            id: "glm-5-3",
            canonical_model_id: "zhipuai/glm-5-3",
            name: "GLM-5.3",
          },
        },
      },
    });

    expect(Object.keys(result)).toEqual(["anthropic/claude-opus-5-2", "zhipuai/glm-5-3"]);
    expect(result["anthropic/claude-opus-5-2"]?.provider_name).toBe("Anthropic");
    expect(result["anthropic/claude-opus-5-2"]?.model.tool_call).toBe(true);
    expect(result["zhipuai/glm-5-3"]?.provider_id).toBe("zai");
  });

  test("ignores malformed providers and models", () => {
    expect(flattenModelsDev({ bad: null, empty: { models: [] }, value: "not a provider" })).toEqual({});
  });

  test("uses the previous artifact when the live catalog fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "models-supplement-"));
    const artifact = join(dir, "supplement.json");
    writeFileSync(artifact, JSON.stringify({
      models: {
        "anthropic/claude-opus-5-2": {
          models_dev: {
            provider_id: "anthropic",
            model: { id: "claude-opus-5-2", name: "Claude Opus 5.2" },
          },
        },
      },
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("upstream unavailable", { status: 503 })) as typeof fetch;
    try {
      const result = await fetchModelsDev(artifact, 1000);
      expect(result.live).toBe(false);
      expect(result.stat.fallback).toBe(true);
      expect(Object.keys(result.models)).toEqual(["anthropic/claude-opus-5-2"]);
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

