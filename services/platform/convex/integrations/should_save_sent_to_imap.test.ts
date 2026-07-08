import { describe, expect, it } from 'vitest';

import { shouldSaveSentToImap } from './should_save_sent_to_imap';

describe('shouldSaveSentToImap', () => {
  it('defaults to true when unset', () => {
    expect(shouldSaveSentToImap({})).toBe(true);
    expect(shouldSaveSentToImap(undefined)).toBe(true);
  });

  it('respects explicit false', () => {
    expect(shouldSaveSentToImap({ saveSentToImap: false })).toBe(false);
    expect(shouldSaveSentToImap({ saveSentToImap: 'false' })).toBe(false);
  });

  it('allows explicit true', () => {
    expect(shouldSaveSentToImap({ saveSentToImap: true })).toBe(true);
    expect(shouldSaveSentToImap({ saveSentToImap: 'true' })).toBe(true);
  });
});
