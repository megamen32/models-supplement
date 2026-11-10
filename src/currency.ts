/**
 * packages/core/src/currency.ts — Centralized currency conversion.
 *
 * Uses the official Bank of Russia daily rates as primary source
 * (https://www.cbr-xml-daily.ru/daily_eng.xml), with commercial FX
 * aggregators as fallbacks.
 *
 * The CBR publishes rates once per business day at ~14:00 MSK, so we cache
 * in-process for the rest of the day and refresh on each process start.
 *
 * Every rate R is "1 base_currency = R target_currency": `1 USD = 74.77 RUB`.
 * routerai.ts converts its RUB-per-token prices with the rate from here.
 */

const CBR_XML_URL = "https://www.cbr-xml-daily.ru/daily_eng.xml";
const CBR_JSON_URL = "https://www.cbr-xml-daily.ru/daily_json.js";
const USD_RUB_FALLBACK = 92.0;

export type Currency = "USD" | "RUB" | "EUR" | "CNY" | "GBP";

export interface CurrencyRate {
  base: Currency;          // "USD"
  quote: Currency;         // "RUB"
  rate: number;           // 1 base = rate quote (e.g. 1 USD = 74.77 RUB)
  source: string;         // "CBR" | "exchangerate.host" | "fallback"
  fetchedAt: string;      // ISO 8601
}

let _cache: CurrencyRate | null = null;
let _inflight: Promise<CurrencyRate> | null = null;

function parseRubFloat(s: string): number {
  return parseFloat(s.replace(",", ".").replace(/\s/g, ""));
}

/** Fetch USD→RUB rate from CBR daily XML (primary). */
async function fetchCbrXmlRate(): Promise<CurrencyRate | null> {
  const res = await fetch(CBR_XML_URL, {
    headers: { Accept: "application/xml,text/xml,*/*" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const xml = await res.text();
  const usdBlock = xml.match(/<CharCode>USD<\/CharCode>[\s\S]*?<\/Valute>/);
  if (!usdBlock) return null;
  const vunit = usdBlock[0].match(/<VunitRate>([0-9,]+)<\/VunitRate>/);
  const nominal = usdBlock[0].match(/<Nominal>([0-9]+)<\/Nominal>/);
  if (!vunit || !nominal) return null;
  const rate = parseRubFloat(vunit[1]) / parseInt(nominal[1], 10);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return {
    base: "USD",
    quote: "RUB",
    rate,
    source: "CBR XML (cbr-xml-daily.ru/daily_eng.xml)",
    fetchedAt: new Date().toISOString(),
  };
}

/** Fetch USD→RUB rate from CBR daily JSON (alternative endpoint). */
async function fetchCbrJsonRate(): Promise<CurrencyRate | null> {
  const res = await fetch(CBR_JSON_URL, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data: any = await res.json();
  const usd = data?.Valute?.USD;
  if (!usd?.Value) return null;
  const rate = parseFloat(usd.Value) / (parseInt(usd.Nominal, 10) || 1);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return {
    base: "USD",
    quote: "RUB",
    rate,
    source: "CBR JSON (cbr-xml-daily.ru/daily_json.js)",
    fetchedAt: new Date().toISOString(),
  };
}

/** Fetch USD→RUB from a commercial FX aggregator (last resort). */
async function fetchAggregatorRate(url: string): Promise<CurrencyRate | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const data: any = await res.json();
  const rate = data?.rates?.RUB ?? data?.conversion_rates?.RUB;
  if (typeof rate !== "number" || rate <= 0) return null;
  return {
    base: "USD",
    quote: "RUB",
    rate,
    source: url,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Get the current USD→RUB rate. Cached in-process; cached value is reused
 * across multiple calls in the same script run (saves ~3 HTTP calls during
 * a typical sync-arena invocation that processes many models).
 */
export async function getUsdRubRate(forceRefresh = false): Promise<CurrencyRate> {
  if (!forceRefresh && _cache) return _cache;
  if (_inflight) return _inflight;

  _inflight = (async () => {
    // Primary: CBR XML
    try {
      const r = await fetchCbrXmlRate();
      if (r) {
        _cache = r;
        return r;
      }
    } catch {
      // try next
    }
    // Primary alternative: CBR JSON
    try {
      const r = await fetchCbrJsonRate();
      if (r) {
        _cache = r;
        return r;
      }
    } catch {
      // try next
    }
    // Commercial FX aggregators
    for (const url of [
      "https://api.exchangerate.host/latest?base=USD&symbols=RUB",
      "https://open.er-api.com/v6/latest/USD",
    ]) {
      try {
        const r = await fetchAggregatorRate(url);
        if (r) {
          _cache = r;
          return r;
        }
      } catch {
        // try next
      }
    }
    // Last resort: hardcoded fallback
    _cache = {
      base: "USD",
      quote: "RUB",
      rate: USD_RUB_FALLBACK,
      source: "fallback (CBR + aggregators unreachable)",
      fetchedAt: new Date().toISOString(),
    };
    return _cache;
  })();

  try {
    return await _inflight;
  } finally {
    _inflight = null;
  }
}
