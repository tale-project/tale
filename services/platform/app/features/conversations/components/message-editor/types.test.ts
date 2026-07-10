import { describe, expect, it } from 'vitest';

import { messageDraftKeys } from './types';

// The key format is a compatibility contract: it must match the format the
// editor used inline before extraction (so existing drafts aren't orphaned),
// and the compose pane's Discard relies on producing the SAME keys the editor
// persists under.
describe('messageDraftKeys', () => {
  it('keys a per-user draft by messageId', () => {
    expect(messageDraftKeys('u1', 'm1')).toEqual({
      body: 'conversation-u1-m1',
      improveInstruction: 'conversation-u1-m1-improve-instruction',
    });
  });

  it('falls back to a shared "new" slot when messageId is absent', () => {
    expect(messageDraftKeys('u1', undefined)).toEqual({
      body: 'conversation-u1-new',
      improveInstruction: 'conversation-u1-new-improve-instruction',
    });
  });

  it('drops the user segment when signed out', () => {
    expect(messageDraftKeys(undefined, 'm1')).toEqual({
      body: 'conversation-m1',
      improveInstruction: 'conversation-m1-improve-instruction',
    });
  });
});
