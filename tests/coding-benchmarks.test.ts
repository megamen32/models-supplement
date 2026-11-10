import { describe, expect, test } from "bun:test";
import { buildCodingBenchmarkManifest } from "../src/coding-benchmarks";
import { sha256 } from "../src/provenance";

describe("coding benchmark manifest", () => {
  test("selects the first available score in the documented priority order", () => {
    const supplement = {
      generated_at: "2026-11-10T00:00:00.000Z",
      models: {
        "vendor/pro": {
          canonical_id: "vendor/pro",
          display_name: "Pro model",
          swebench_pro: { score: 0.2, raw_score: 20 },
          swe_bench_verified: { score: 0.9, raw_score: 90 },
          benchmark_sources: [],
        },
        "vendor/verified": {
          canonical_id: "vendor/verified",
          display_name: "Verified model",
          swe_bench_verified: { score: 0.3, raw_score: 30, date: "2026-01-02" },
          swe_bench_lite: { score: 0.4, raw_score: 40 },
          benchmark_sources: [],
        },
        "vendor/lite": {
          canonical_id: "vendor/lite",
          display_name: "Lite model",
          swe_bench_lite: { score: 0, raw_score: 0 },
          benchmark_sources: [],
        },
        "vendor/multilingual": {
          canonical_id: "vendor/multilingual",
          display_name: "Multilingual model",
          swe_bench_multilingual: { score: 0.5, raw_score: 50 },
          benchmark_sources: [],
        },
        "vendor/none": {
          canonical_id: "vendor/none",
          display_name: "No coding result",
          benchmark_sources: [],
        },
      },
      sources: {
        hle: "https://example.test/hle",
        swe_bench_leaderboard: "https://example.test/swe",
      },
    };

    const manifest = buildCodingBenchmarkManifest(supplement, {
      generatedAt: "2026-11-10T00:00:01.000Z",
    });

    expect(Object.keys(manifest.models)).toEqual([
      "vendor/lite",
      "vendor/multilingual",
      "vendor/pro",
      "vendor/verified",
    ]);
    expect(manifest.models["vendor/pro"]).toMatchObject({
      source: "swebench_pro",
      benchmark: "SWE-bench Pro",
      normalized_score: 0.2,
      raw_score: 20,
      source_url: "https://example.test/hle",
    });
    expect(manifest.models["vendor/verified"]).toMatchObject({
      source: "swe_bench_verified",
      benchmark_name: "SWE-bench Verified",
      normalized_score: 0.3,
      raw_score: 30,
      date: "2026-01-02",
    });
    expect(manifest.models["vendor/lite"]?.normalized_score).toBe(0);
    expect(manifest.models["vendor/none"]).toBeUndefined();
    expect(manifest.generated_at).toBe("2026-11-10T00:00:01.000Z");
  });

  test("records provenance for the source artifact", () => {
    const supplement = {
      generated_at: "2026-11-10T00:00:00.000Z",
      models: {},
      provenance: {
        git: { commit: "abc1234", dirty: false, branch: "main" },
        sources: [
          {
            name: "cais_dashboard",
            url: "https://example.test/hle",
            ok: true,
            fetched_at: "2026-11-10T00:00:00.000Z",
            duration_ms: 10,
            bytes: 42,
            sha256: "feedface",
          },
        ],
      },
    };
    const serialized = JSON.stringify(supplement, null, 2);
    const manifest = buildCodingBenchmarkManifest(supplement);

    expect(manifest.provenance.source_sha256).toBe(sha256(serialized));
    expect(manifest.provenance.source_git).toEqual(supplement.provenance.git);
    expect(manifest.provenance.source_fetches).toHaveLength(1);
    expect(manifest.provenance.source_fetches[0]?.name).toBe("cais_dashboard");
  });
});

