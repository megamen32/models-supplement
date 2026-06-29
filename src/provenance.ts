/**
 * provenance.ts — Build-environment fingerprint for supplement.json.
 *
 * Mirrors the JSON-manifest pattern from llm-inference-benchmark: every
 * emitted artifact carries a `provenance` block with git state, runtime
 * versions, per-source fetch stats, and a SHA-256 of the final bytes —
 * so consumers can answer "where did this number come from" months later.
 *
 * All helpers are best-effort: they never throw on missing git or unusual
 * environments (Docker, CI without checkout). They just record `null`.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export interface GitInfo {
  commit: string | null;
  dirty: boolean;
  branch: string | null;
}

export interface EnvFingerprint {
  node_version: string;
  bun_version: string;
  os: string;
  arch: string;
  ci: string | null;
}

export interface SourceFetch {
  name: string;
  url: string;
  ok: boolean;
  fetched_at: string;
  duration_ms: number;
  bytes: number;
  sha256: string;
  error?: string;
}

/** Alias used by source modules (arena, routerai) for their fetch stats. */
export type FetchStat = SourceFetch;

/** Read git state via short-lived child processes. Returns nulls on failure. */
export function getGitInfo(cwd: string = process.cwd()): GitInfo {
  const commit = gitShort(cwd, ["rev-parse", "--short", "HEAD"]);
  const branch = gitShort(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  let dirty = false;
  try {
    const r = spawnSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
    });
    if (r.status === 0) {
      dirty = r.stdout.trim().length > 0;
    }
  } catch {
    // not a git checkout — leave dirty=false
  }
  return { commit, dirty, branch };
}

function gitShort(cwd: string, args: string[]): string | null {
  try {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 5000 });
    if (r.status !== 0) return null;
    const out = r.stdout.trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Identify the runtime environment (Bun constant + Node fallback). */
export function getEnvFingerprint(): EnvFingerprint {
  const bunVer = typeof Bun !== "undefined" && Bun.version ? Bun.version : null;
  return {
    node_version: process.version,
    bun_version: bunVer ?? process.version,
    os: `${process.platform} ${process.release?.name ?? ""}`.trim(),
    arch: process.arch,
    ci: process.env.GITHUB_ACTIONS
      ? `github-actions:${process.env.GITHUB_RUN_ID ?? ""}`
      : process.env.CI
        ? "ci"
        : null,
  };
}

/** SHA-256 hex digest of a string. */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** SHA-256 hex digest of a byte sequence (UTF-8 encoded). */
export function sha256Bytes(s: string): string {
  return sha256(s);
}