import "server-only";

/**
 * Zillow AVM via RapidAPI (zillow-property-data1). This API is asynchronous:
 *   1. POST /v1/properties { search, type, max_items }  ->  { job_id, status }
 *   2. GET  /v1/results/{job_id}  (poll until status === "complete")
 *      ->  results[0].property.zestimate
 * Jobs typically complete in ~30s. Returns the zestimate as a number, or null
 * on ANY failure/timeout — this must never throw or break the UI.
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

interface JobResponse {
  job_id?: string;
  status?: string;
  results?: { property?: { zestimate?: number | null } }[];
}

function zestimateFrom(data: JobResponse): number | null {
  return toNum(data?.results?.[0]?.property?.zestimate ?? null);
}

export async function getZillowAVM(address: string): Promise<number | null> {
  const key = process.env.RAPIDAPI_KEY?.replace(/\s/g, "");
  if (!key || !address?.trim()) return null;

  const headers = {
    "Content-Type": "application/json",
    "x-rapidapi-host": HOST,
    "x-rapidapi-key": key,
  };

  try {
    // 1) Start the async job.
    const startRes = await fetch(`https://${HOST}/v1/properties`, {
      method: "POST",
      headers,
      body: JSON.stringify({ search: address, type: "sale", max_items: 1 }),
    });
    if (!startRes.ok) {
      console.warn(`[zillow] start ${startRes.status} for "${address}"`);
      return null;
    }
    const start: JobResponse = await startRes.json();

    // Occasionally results are already present on the start response.
    const immediate = zestimateFrom(start);
    if (immediate != null) return immediate;

    const jobId = start.job_id;
    if (!jobId) return null;

    // 2) Poll the results endpoint until the job reaches a terminal status.
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_INTERVAL_MS);
      const res = await fetch(`https://${HOST}/v1/results/${jobId}`, { method: "GET", headers });
      if (!res.ok) continue;
      const data: JobResponse = await res.json();
      if (data.status && data.status !== "processing") {
        return zestimateFrom(data); // "complete" (or terminal) — value or null
      }
    }

    console.warn(`[zillow] job timed out for "${address}"`);
    return null;
  } catch (e) {
    console.warn("[zillow] lookup failed:", (e as Error).message);
    return null;
  }
}
