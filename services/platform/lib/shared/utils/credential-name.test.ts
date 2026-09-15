import { describe, expect, it } from 'vitest';

import { uniqueCredentialName } from './credential-name.ts';

/**
 * One numbering rule behind every credential Tale names for the operator —
 * the add dialog's suggestion and an OAuth grant's stored label. The two
 * used to live apart, and only the grant numbered at all.
 */
describe('uniqueCredentialName', () => {
  it('keeps the base when no sibling holds it', () => {
    expect(uniqueCredentialName([], 'OpenRouter')).toBe('OpenRouter');
    expect(uniqueCredentialName(['Production key'], 'OpenRouter')).toBe(
      'OpenRouter',
    );
  });

  it('numbers from 2 once the base is taken', () => {
    expect(uniqueCredentialName(['OpenRouter'], 'OpenRouter')).toBe(
      'OpenRouter 2',
    );
  });

  it('counts past every taken label, case-insensitively and trimmed', () => {
    expect(
      uniqueCredentialName(['openrouter', ' OpenRouter 2 '], 'OpenRouter'),
    ).toBe('OpenRouter 3');
  });

  it('takes the first free number, reusing a gap a deleted sibling left', () => {
    expect(
      uniqueCredentialName(['OpenRouter', 'OpenRouter 3'], 'OpenRouter'),
    ).toBe('OpenRouter 2');
    expect(uniqueCredentialName(['OpenRouter 2'], 'OpenRouter')).toBe(
      'OpenRouter',
    );
  });
});
