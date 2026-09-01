import "server-only";

/** Any deal shape the address matcher can work with. */
export interface MatchableDeal {
  id: string;
  property_address: string;
}

export type MatchResult<T> =
  | { method: "matched"; deal: T }
  | { method: "unmatched" }
  | { method: "ambiguous"; candidates: T[] };

/** Street-number token + significant word tokens from a free-text address. */
export function tokenizeAddress(address: string): { streetNumber: string | null; words: string[] } {
  const tokens = address.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const streetNumber = tokens.find((t) => /^\d+$/.test(t)) ?? null;
  const words = tokens.filter((t) => !/^\d+$/.test(t) && t.length > 3);
  return { streetNumber, words };
}

/**
 * Anchored on the street number — financial/deal documents and correspondence
 * are higher stakes than a loose text match. Requires the street number AND at
 * least one street-name word to appear in the text. Zero or multiple matches
 * both fall back to "don't guess" (unmatched / ambiguous).
 */
export function matchDeal<T extends MatchableDeal>(text: string, deals: T[]): MatchResult<T> {
  const lower = text.toLowerCase();
  const matches: T[] = [];
  for (const deal of deals) {
    const { streetNumber, words } = tokenizeAddress(deal.property_address);
    if (!streetNumber) continue;
    if (lower.includes(streetNumber) && words.some((w) => lower.includes(w))) {
      matches.push(deal);
    }
  }
  if (matches.length === 1) return { method: "matched", deal: matches[0] };
  if (matches.length === 0) return { method: "unmatched" };
  return { method: "ambiguous", candidates: matches };
}

/** Build compact Gmail phrase terms ("<streetNumber> <firstWord>") for a deal set. */
export function addressSearchPhrases(deals: MatchableDeal[]): string[] {
  const phrases: string[] = [];
  for (const d of deals) {
    const { streetNumber, words } = tokenizeAddress(d.property_address);
    if (streetNumber && words[0]) phrases.push(`"${streetNumber} ${words[0]}"`);
  }
  return phrases;
}
