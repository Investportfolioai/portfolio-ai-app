import "server-only";

/**
 * Zillow AVM via RapidAPI (zillow-property-data1). This API is asynchronous:
 *   1. POST /v1/properties { search, type, max_items }  ->  { job_id, status }
 *   2. GET  /v1/results/{job_id}  (poll until status === "complete")
 *      ->  results[0].property.zestimate (or list price / price history as fallback)
 * Jobs typically complete in ~30s. Returns { value, source } or null on failure.
 */

const HOST = "zillow-property-data1.p.rapidapi.com";
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 13; // ~39s of polling; stays under the 60s serverless limit.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,\s]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

interface PropertyData {
  zestimate?: number | null;
  zestimateAmount?: number | null;
  price?: number | null;
  listPrice?: number | null;
  listing_price?: number | null;
  lastSoldPrice?: number | null;
  priceHistory?: { price?: number | null; event?: string }[];
  price_history?: { price?: number | null; event?: string }[];
}

interface JobResponse {
  job_id?: string;
  status?: string;
  results?: { property?: PropertyData }[];
}

export interface AVMResult {
  value: number;
  source: "Zestimate" | "List Price" | "Price History";
}

function extractPrice(data: JobResponse): AVMResult | null {
  const prop = data?.results?.[0]?.property;
  if (!prop) return null;

  // 1. Zestimate — most accurate AVM.
  const zestimate = toNum(prop.zestimate ?? prop.zestimateAmount);
  if (zestimate != null) return { value: zestimate, source: "Zestimate" };

  // 2. Active listing price.
  const listPrice = toNum(prop.listPrice ?? prop.price ?? prop.listing_price);
  if (listPrice != null) return { value: listPrice, source: "List Price" };

  // 3. Most recent price history entry.
  const history = prop.priceHistory ?? prop.price_history ?? [];
  for (const entry of history) {
    const hp = toNum(entry.price);
    if (hp != null) return { value: hp, source: "Price History" };
  }

  return null;
}

async function runJob(
  address: string,
  type: string,
  headers: Record<string, string>,
  label: string,
): Promise<AVMResult | null> {
  const startRes = await fetch(`https://${HOST}/v1/properties`, {
    method: "POST",
    headers,
    body: JSON.stringify({ search: address, type, max_items: 1 }),
  });

  if (!startRes.ok) {
    let body: unknown = "<non-JSON>";
    try { body = await startRes.json(); } catch { /* ignore */ }
    console.error(`[zillow] ${label} start failed — HTTP ${startRes.status}:`, JSON.stringify(body));
    return null;
  }

  const start: JobResponse = await startRes.json();
  console.log(`[zillow] ${label} start response:`, JSON.stringify(start));

  const immediate = extractPrice(start);
  if (immediate != null) return immediate;

  const jobId = start.job_id;
  if (!jobId) {
    console.error(`[zillow] ${label} — no job_id in start response`);
    return null;
  }

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(`https://${HOST}/v1/results/${jobId}`, { method: "GET", headers });

    if (!res.ok) {
      let body: unknown = "<non-JSON>";
      try { body = await res.json(); } catch { /* ignore */ }
      console.error(`[zillow] ${label} poll ${i} failed — HTTP ${res.status}:`, JSON.stringify(body));
      continue;
    }

    const data: JobResponse = await res.json();

    if (data.status && data.status !== "processing") {
      const result = extractPrice(data);
      if (result == null) {
        console.error(`[zillow] ${label} job complete but no price found — full result:`, JSON.stringify(data));
      } else {
        console.log(`[zillow] ${label} found via ${result.source}: ${result.value}`);
      }
      return result;
    }
  }

  console.warn(`[zillow] ${label} job timed out for "${address}"`);
  return null;
}

export async function getZillowAVM(address: string): Promise<AVMResult | null> {
  const key = process.env.RAPIDAPI_KEY?.replace(/\s/g, "");
  if (!key || !address?.trim()) return null;

  const headers = {
    "Content-Type": "application/json",
    "x-rapidapi-host": HOST,
    "x-rapidapi-key": key,
  };

  try {
    // Primary: type=sale search.
    const primary = await runJob(address, "sale", headers, `primary(sale) "${address}"`);
    if (primary != null) return primary;

    // Fallback: type=zestimate — different search mode, often succeeds when "sale" finds nothing.
    console.log(`[zillow] primary returned null — retrying with type=zestimate for "${address}"`);
    const fallback = await runJob(address, "zestimate", headers, `fallback(zestimate) "${address}"`);
    if (fallback == null) {
      console.error(`[zillow] both attempts returned null for "${address}"`);
    }
    return fallback;
  } catch (e) {
    console.error("[zillow] unexpected error:", (e as Error).message);
    return null;
  }
}
