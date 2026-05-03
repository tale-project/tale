/**
 * Shared fixture types. Each fixture file exports an array of cases asserting
 * what `detectPii(input, [addressPattern]).map(m => m.matchedText)` should
 * equal — exact strings, in the order they appear in `input`.
 *
 * For negative cases, set `expectedMatches: []`. Avoids brittle "no match"
 * checks elsewhere.
 */
export interface AddressCase {
  input: string;
  expectedMatches: string[];
  /** Optional: source citation for the sample (e.g. "Berlin Postleitzahl Wikipedia"). */
  note?: string;
}

export interface PhoneCase {
  input: string;
  /** Numbers (without keyword prefix) the detector should mask. */
  expectedMatches: string[];
  note?: string;
}

export interface ChecksumCase {
  input: string;
  shouldMatch: boolean;
  note?: string;
}
