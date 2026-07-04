import { describe, expect, it } from 'vitest';

import { normalizeExternalMessageId } from './normalize_external_message_id';

describe('normalizeExternalMessageId', () => {
  it('strips angle brackets from RFC Message-IDs', () => {
    expect(normalizeExternalMessageId('<abc@calendly.com>')).toBe(
      'abc@calendly.com',
    );
  });

  it('returns undefined for empty input', () => {
    expect(normalizeExternalMessageId('')).toBeUndefined();
    expect(normalizeExternalMessageId(undefined)).toBeUndefined();
  });

  it('trims whitespace', () => {
    expect(normalizeExternalMessageId('  abc@x.com  ')).toBe('abc@x.com');
  });
});
