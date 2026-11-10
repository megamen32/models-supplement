import { canonicalId } from "./canonical";
import type { FetchStat } from "./provenance";
import type { SourceResult } from "./source";

export const AIDER_URL = "https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml";
export const LIVEBENCH_RELEASE = "20261106";
export const LIVEBENCH_TABLE_URL = "https://livebench.ai/data/20261106/table.csv";
export const LIVEBENCH_CATEGORIES_URL = "https://livebench.ai/data/20261106/categories.json";

export const TERMINAL_BENCH_RELEASE = "2.1";
export const TERMINAL_BENCH_PACKAGE = "terminal-bench/terminal-bench-2-1";
export const TERMINAL_BENCH_NAME = "main";
export const TERMINAL_BENCH_URL = "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read";
export const TERMINAL_BENCH_PUBLISHABLE_KEY = "sb_publishable_Z-vuQbpvpG-PStjbh4yE0Q_e-d3MTIH";
export const TERMINAL_REPO_URL = "https://github.com/harbor-framework/terminal-bench-2-1/tree/main/leaderboard";

export interface AiderVariant {
  variant_id: string;
  score: number;
  raw_score: number;
  pass_rate_1?: number;
  test_cases?: number;
  edit_format?: string;
  command?: string;
  model?: string;
  date?: string;
  variant_type: "model" | "agent";
  source_url: string;
}
export interface AiderEntry {
  score: number;
  raw_score: number;
  pass_rate_1?: number;
  test_cases?: number;
  edit_format?: string;
  command?: string;
  date?: string;
  variants: AiderVariant[];
  aggregation: "max_pass_rate_2";
  source_url: string;
}
export interface LiveBenchEntry {
  score: number;
  raw_score: number;
  coding_score: number;
  long_agentic_score?: number;
  scores: Record<string, number>;
  release: string;
  source_url: string;
  categories_url: string;
}
export interface TerminalBenchRow {
  model_display: string;
  model_url?: string;
  agent_display: string;
  agent_url?: string;
  reasoning_effort: string;
  accuracy: number;
  rank?: number;
  metrics: Record<string, number>;
  metadata: Record<string, unknown>;
  source_url: string;
}
export interface TerminalBenchEntry {
  score: number;
  raw_score: number;
  dataset: string;
  dataset_version: string;
  agent: string;
  reasoning_effort: string;
  rows: TerminalBenchRow[];
  aggregation: "max_accuracy";
  release: string;
  source_url: string;
}

type JR<T> = { data: T; stat: FetchStat };

async function text(url: string, timeout = 30000): Promise<JR<string>> {
  const t = performance.now();
  const fetched_at = new Date().toISOString();
  const base = (x: Partial<FetchStat> = {}): FetchStat => ({
    name: url,
    url,
    ok: false,
    fetched_at,
    duration_ms: Math.round(performance.now() - t),
    bytes: 0,
    sha256: "",
    ...x,
  });
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      headers: { Accept: "text/plain,application/json", "User-Agent": "models-supplement/1" },
    });
    if (!r.ok) return { data: "", stat: base({ error: "HTTP " + r.status }) };
    const body = await r.text();
    const { sha256 } = await import("./provenance");
    return { data: body, stat: base({ ok: true, bytes: body.length, sha256: sha256(body) }) };
  } catch (e) {
    return { data: "", stat: base({ error: String(e) }) };
  }
}

async function postJson<T>(url: string, body: unknown, timeout = 30000): Promise<JR<T>> {
  const t = performance.now();
  const fetched_at = new Date().toISOString();
  const base = (x: Partial<FetchStat> = {}): FetchStat => ({
    name: url,
    url,
    ok: false,
    fetched_at,
    duration_ms: Math.round(performance.now() - t),
    bytes: 0,
    sha256: "",
    ...x,
  });
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(timeout),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        apikey: TERMINAL_BENCH_PUBLISHABLE_KEY,
        "User-Agent": "models-supplement/1",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { data: undefined as T, stat: base({ error: "HTTP " + r.status }) };
    const raw = await r.text();
    const { sha256 } = await import("./provenance");
    try {
      return { data: JSON.parse(raw) as T, stat: base({ ok: true, bytes: raw.length, sha256: sha256(raw) }) };
    } catch (e) {
      return { data: undefined as T, stat: base({ error: "invalid JSON: " + String(e) }) };
    }
  } catch (e) {
    return { data: undefined as T, stat: base({ error: String(e) }) };
  }
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const scalar = (v: string): string | number | boolean | null => {
  const s = v.trim().replace(/^[\"']|[\"']$/g, "");
  if (!s || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
};

export function canonicalCodingId(vendor: string | null | undefined, name: string): string | null {
  return canonicalId(vendor, name.replace(/m3p1/gi, "m3.1"));
}

export function parseAiderYaml(s: string): Array<Record<string, string | number | boolean | null>> {
  const out: Array<Record<string, string | number | boolean | null>> = [];
  let row: Record<string, string | number | boolean | null> | null = null;
  for (const line of s.split(/\r?\n/)) {
    const start = line.match(/^- dirname:\s*(.*)$/);
    if (start) {
      row = { dirname: scalar(start[1]) };
      out.push(row);
      continue;
    }
    const f = line.match(/^\s{2}([A-Za-z0-9_]+):\s*(.*)$/);
    if (f && row) row[f[1]] = scalar(f[2]);
  }
  return out;
}

function aiderVariantId(row: Record<string, string | number | boolean | null>): string {
  return [row.dirname, row.date, row.command, row.edit_format]
    .filter((v): v is string | number | boolean => v !== undefined && v !== null && v !== "")
    .join("|");
}

function aiderId(row: Record<string, string | number | boolean | null>): string | null {
  const model = typeof row.model === "string" ? row.model : "";
  const command = typeof row.command === "string" ? row.command : "";
  const match = command.match(/(?:^|\s)--model\s+[\"']?([^\"'\s]+)/);
  const raw = (match?.[1] ?? model).replace(/^openrouter\//, "");
  if (!raw) return null;
  const slash = raw.indexOf("/");
  return slash >= 0 ? canonicalCodingId(raw.slice(0, slash), raw.slice(slash + 1)) : canonicalCodingId(null, raw);
}

function aiderVariant(row: Record<string, string | number | boolean | null>): AiderVariant | null {
  const raw = num(row.pass_rate_2);
  const id = aiderId(row);
  if (!id || raw === undefined || raw < 0) return null;
  const model = typeof row.model === "string" ? row.model : undefined;
  const command = typeof row.command === "string" ? row.command : undefined;
  const variant_type: "model" | "agent" =
    /[+]|architect|editor/i.test((model ?? "") + " " + (command ?? "")) ? "agent" : "model";
  return {
    variant_id: aiderVariantId(row),
    score: raw / 100,
    raw_score: raw,
    ...(num(row.pass_rate_1) !== undefined ? { pass_rate_1: num(row.pass_rate_1) } : {}),
    ...(num(row.test_cases) !== undefined ? { test_cases: num(row.test_cases) } : {}),
    ...(typeof row.edit_format === "string" ? { edit_format: row.edit_format } : {}),
    ...(command ? { command } : {}),
    ...(model ? { model } : {}),
    ...(typeof row.date === "string" ? { date: row.date } : {}),
    variant_type,
    source_url: AIDER_URL,
  };
}

export function aggregateAiderVariants(variants: AiderVariant[]): AiderEntry {
  const unique = [...new Map(variants.map((v) => [v.variant_id, v])).values()];
  const candidates = unique.filter((v) => v.variant_type === "model");
  const pool = candidates.length ? candidates : unique;
  const best = pool.reduce((a, b) => (a.raw_score >= b.raw_score ? a : b));
  return {
    score: best.score,
    raw_score: best.raw_score,
    ...(best.pass_rate_1 !== undefined ? { pass_rate_1: best.pass_rate_1 } : {}),
    ...(best.test_cases !== undefined ? { test_cases: best.test_cases } : {}),
    ...(best.edit_format ? { edit_format: best.edit_format } : {}),
    ...(best.command ? { command: best.command } : {}),
    ...(best.date ? { date: best.date } : {}),
    variants: unique,
    aggregation: "max_pass_rate_2",
    source_url: AIDER_URL,
  };
}

export async function fetchAider(): Promise<SourceResult<Record<string, AiderEntry>>> {
  const r = await text(AIDER_URL, 60000);
  const variants: Record<string, AiderVariant[]> = {};
  if (r.stat.ok) {
    for (const row of parseAiderYaml(r.data)) {
      const v = aiderVariant(row);
      const id = v ? aiderId(row) : null;
      if (!v || !id) continue;
      (variants[id] ??= []).push(v);
    }
  }
  const out: Record<string, AiderEntry> = {};
  for (const [id, rows] of Object.entries(variants)) out[id] = aggregateAiderVariants(rows);
  return { ok: r.stat.ok && Object.keys(out).length > 0, records: out, error: r.stat.error, stats: [{ ...r.stat, name: "aider_polyglot" }] };
}

function csvLine(line: string): string[] {
  const out: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\"") {
      if (quoted && line[i + 1] === "\"") {
        value += "\"";
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(value);
      value = "";
    } else value += ch;
  }
  out.push(value);
  return out;
}

export function parseLiveBenchCsv(s: string): Array<Record<string, string>> {
  const lines = s.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = csvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = csvLine(line);
    return Object.fromEntries(headers.map((key, i) => [key, values[i] ?? ""]));
  });
}

export async function fetchLiveBench(): Promise<SourceResult<Record<string, LiveBenchEntry>>> {
  const [table, categories] = await Promise.all([text(LIVEBENCH_TABLE_URL), text(LIVEBENCH_CATEGORIES_URL)]);
  const out: Record<string, LiveBenchEntry> = {};
  if (table.stat.ok) {
    for (const row of parseLiveBenchCsv(table.data)) {
      const coding = num(row.coding);
      const id = row.model ? canonicalCodingId(null, row.model.trim()) : null;
      if (!id || coding === undefined) continue;
      const scores: Record<string, number> = {};
      for (const [key, value] of Object.entries(row)) {
        const score = num(value);
        if (key !== "model" && score !== undefined) scores[key] = score;
      }
      out[id] = {
        score: coding / 100,
        raw_score: coding,
        coding_score: coding,
        ...(num(row.long_agentic) !== undefined ? { long_agentic_score: num(row.long_agentic) } : {}),
        scores,
        release: LIVEBENCH_RELEASE,
        source_url: LIVEBENCH_TABLE_URL,
        categories_url: LIVEBENCH_CATEGORIES_URL,
      };
    }
  }
  return {
    ok: table.stat.ok && Object.keys(out).length > 0,
    records: out,
    error: table.stat.error ?? categories.stat.error,
    stats: [{ ...table.stat, name: "livebench:table" }, { ...categories.stat, name: "livebench:categories" }],
  };
}

type HarborLink = string | { label?: string; url?: string };
type HarborRow = { id?: string; rank?: number; metadata?: Record<string, unknown>; metrics?: Record<string, unknown> };

function linkLabel(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as HarborLink).label === "string") return (value as HarborLink).label!;
  return "";
}
function linkUrl(value: unknown): string | undefined {
  if (value && typeof value === "object" && typeof (value as HarborLink).url === "string") return (value as HarborLink).url;
  return typeof value === "string" ? value : undefined;
}

export function parseHarborRow(row: HarborRow): { id: string; value: TerminalBenchRow } | null {
  const metadata = row.metadata ?? {};
  const metrics = row.metrics ?? {};
  const display = linkLabel(metadata.model_display);
  const rawModel = typeof metadata.model_id === "string" ? metadata.model_id : typeof metadata.model === "string" ? metadata.model : display;
  const id = canonicalCodingId(null, rawModel);
  const accuracy = num(metrics.accuracy);
  if (!id || !display || accuracy === undefined || accuracy < 0) return null;
  const agent = linkLabel(metadata.agent_display) || "unknown";
  const effort = typeof metadata.reasoning_effort === "string" ? metadata.reasoning_effort : "none";
  const numericMetrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(metrics)) {
    const n = num(value);
    if (n !== undefined) numericMetrics[key] = n;
  }
  const source_url = TERMINAL_BENCH_URL + "?package=" + encodeURIComponent(TERMINAL_BENCH_PACKAGE) + "&name=" + TERMINAL_BENCH_NAME;
  return {
    id,
    value: {
      model_display: display,
      ...(linkUrl(metadata.model_display) ? { model_url: linkUrl(metadata.model_display) } : {}),
      agent_display: agent,
      ...(linkUrl(metadata.agent_display) ? { agent_url: linkUrl(metadata.agent_display) } : {}),
      reasoning_effort: effort,
      accuracy,
      ...(typeof row.rank === "number" ? { rank: row.rank } : {}),
      metrics: numericMetrics,
      metadata,
      source_url,
    },
  };
}

export async function fetchTerminalBench(): Promise<SourceResult<Record<string, TerminalBenchEntry>>> {
  const response = await postJson<{ rows?: HarborRow[] }>(TERMINAL_BENCH_URL, { package: TERMINAL_BENCH_PACKAGE, name: TERMINAL_BENCH_NAME, page: 1, page_size: 500 }, 60000);
  const out: Record<string, TerminalBenchEntry> = {};
  if (response.stat.ok && Array.isArray(response.data?.rows)) {
    for (const row of response.data.rows) {
      const parsed = parseHarborRow(row);
      if (!parsed) continue;
      const old = out[parsed.id];
      const rows = [...(old?.rows ?? []), parsed.value];
      const best = rows.reduce((a, b) => (a.accuracy >= b.accuracy ? a : b));
      out[parsed.id] = {
        score: best.accuracy / 100,
        raw_score: best.accuracy,
        dataset: TERMINAL_BENCH_PACKAGE,
        dataset_version: TERMINAL_BENCH_RELEASE,
        agent: best.agent_display,
        reasoning_effort: best.reasoning_effort,
        rows,
        aggregation: "max_accuracy",
        release: TERMINAL_BENCH_RELEASE,
        source_url: best.source_url,
      };
    }
  }
  return { ok: response.stat.ok && Object.keys(out).length > 0, records: out, error: response.stat.error, stats: [{ ...response.stat, name: "terminal_bench:leaderboard" }] };
}
