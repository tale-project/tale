import { describe, expect, it } from 'vitest';

import { deriveFallbackTitle } from './derive_fallback_title';

describe('deriveFallbackTitle (#1981)', () => {
  it('returns the trimmed message when short enough', () => {
    expect(deriveFallbackTitle('  Plan my trip to Lisbon  ')).toBe(
      'Plan my trip to Lisbon',
    );
  });

  it('collapses internal whitespace and newlines', () => {
    expect(deriveFallbackTitle('Summarize\n\n  this   document')).toBe(
      'Summarize this document',
    );
  });

  it('truncates long messages with an ellipsis', () => {
    const out = deriveFallbackTitle('a'.repeat(100));
    expect(out).not.toBeNull();
    expect(out?.endsWith('…')).toBe(true);
    // 60-char slice + the ellipsis character.
    expect(out?.length).toBeLessThanOrEqual(61);
  });

  it('produces distinct titles for distinct messages (not a shared default)', () => {
    expect(deriveFallbackTitle('First question')).not.toBe(
      deriveFallbackTitle('Second question'),
    );
  });

  it('returns null for empty or whitespace-only source', () => {
    expect(deriveFallbackTitle('')).toBeNull();
    expect(deriveFallbackTitle('   \n  ')).toBeNull();
  });
});
