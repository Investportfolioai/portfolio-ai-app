import "server-only";

/**
 * Zillow AVM lookup via RapidAPI. Returns the estimated value (zestimate) as a
 * number, or null on ANY failure — this must never throw or break the UI.
 */

const HOST = "zillow-property-data1.p.rapidapi.com";

const VALUE_KEYS = new Set(
  [
    "zestimate",
    "zestimateAmount",
    "zestimate_amount",
    "estimatedValue",
    "estimated_value",
    "avm",
    "value",
    "price",
    "amount",
  ].map((k) => k.toLowerCase()),
);

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,\s]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Find the first plausible value under a known key (shallowest match wins). */
function extractValue(node: unknown, depth = 0): number | null {
  if (node == null || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = extractValue(item, depth + 1);
      if (r != null) return r;
    }
    return null;
  }
  if (typeof node === "object") {
    const entries = Object.entries(node as Record<string, unknown>);
    // Prefer a direct key match at this level.
    for (const [k, v] of entries) {
      if (VALUE_KEYS.has(k.toLowerCase())) {
        const n = toNum(v);
        if (n != null) return n;
      }
    }
    // Otherwise descend.
    for (const [, v] of entries) {
      const r = extractValue(v, depth + 1);
      if (r != null) return r;
    }
  }
  return null;
}

export async function getZillowAVM(address: string): Promise<number | null> {
  const key = process.env.RAPIDAPI_KEY?.replace(/\s/g, "");
  if (!key || !address?.trim()) return null;
  try {
    const res = await fetch(`https://${HOST}/v1/results`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-host": HOST,
        "x-rapidapi-key": key,
      },
      body: JSON.stringify({ address }),
    });
    if (!res.ok) {
      console.warn(`[zillow] ${res.status} for "${address}"`);
      return null;
    }
    const data = await res.json();
    return extractValue(data);
  } catch (e) {
    console.warn("[zillow] lookup failed:", (e as Error).message);
    return null;
  }
}
