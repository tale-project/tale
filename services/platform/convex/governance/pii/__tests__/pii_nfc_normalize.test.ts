import { describe, expect, it } from 'vitest';

import { type PiiConfig, scrubPii } from '../index';

/**
 * Strings copied from macOS clipboard / some IMEs are NFD-decomposed: `é`
 * arrives as `e` + U+0301 combining acute. Detector patterns embedding
 * precomposed `é` (e.g. the phone context regex's `t[ée]l\.?`) miss those
 * inputs entirely. `scrubPii` normalizes the input to NFC at the entrypoint
 * so detection is encoding-independent.
 *
 * Built with explicit code-point escapes so the test is robust to source-file
 * editor canonicalization (which would otherwise silently rewrite NFD → NFC
 * at save time).
 */

const cfg: PiiConfig = {
  enabled: true,
  mode: 'mask',
  enabledPatterns: ['phone', 'address'],
  customPatterns: [],
};

const COMBINING_ACUTE = '́'; // U+0301 COMBINING ACUTE ACCENT
const NFD_e_acute = 'e' + COMBINING_ACUTE; // 2 code points
const NFD_E_acute = 'E' + COMBINING_ACUTE;

describe('NFC normalize at scrubPii entrypoint', () => {
  it('matches NFD-encoded `Tél:` phone label', () => {
    const nfd = `T${NFD_e_acute}l: 06 12 34 56 78`;
    const nfc = nfd.normalize('NFC');
    expect(nfd).not.toBe(nfc); // sanity: NFD ≠ NFC
    expect(nfd.length).toBeGreaterThan(nfc.length);

    const result = scrubPii(nfd, cfg);
    expect(result.kind).toBe('modified');
    if (result.kind !== 'modified') return;
    // Output is in NFC form — keyword "Tél" stays unmasked, only the number
    // becomes [PHONE].
    expect(result.text).toBe('Tél: [PHONE]');
    expect(result.categoryIds).toContain('phone');
  });

  it('matches NFD-encoded address with accented street name', () => {
    const nfd = `5 avenue des Champs-${NFD_E_acute}lys${NFD_e_acute}es, 75008 Paris`;
    const result = scrubPii(nfd, cfg);
    expect(result.kind).toBe('modified');
    if (result.kind !== 'modified') return;
    // Whole address line collapses to one [ADDRESS]
    expect(result.text).toBe('[ADDRESS]');
  });

  it('passes through unchanged when no PII detected', () => {
    // No-PII NFD input must NOT be NFC-rewritten by scrubPii — `pass()` keeps
    // the original text. Downstream consumers (chat history, LLM payload)
    // should see the user's original encoding.
    const nfd = `Bonjour, je m'appelle Marie.`;
    const result = scrubPii(nfd, cfg);
    expect(result.kind).toBe('pass');
  });

  it('NFC normalization is idempotent (no double-rewrite)', () => {
    const nfc = 'Tél: 06 12 34 56 78';
    const result1 = scrubPii(nfc, cfg);
    expect(result1.kind).toBe('modified');
    if (result1.kind !== 'modified') return;
    const result2 = scrubPii(result1.text, cfg);
    expect(result2.kind).toBe('pass'); // already masked, no PII left
  });
});
