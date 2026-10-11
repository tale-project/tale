import { describe, expect, it } from 'vitest';

import { hasReplyRecipient, UNKNOWN_CONTACT_EMAIL } from './reply-recipient';

describe('hasReplyRecipient', () => {
  it('answers a mirrored conversation through its source, with or without an address', () => {
    expect(hasReplyRecipient({ channel: 'api', contactEmail: '' })).toBe(true);
    expect(hasReplyRecipient({ channel: 'api', contactEmail: null })).toBe(
      true,
    );
    expect(hasReplyRecipient({ channel: 'api' })).toBe(true);
    expect(
      hasReplyRecipient({ channel: 'api', contactEmail: 'dana@example.com' }),
    ).toBe(true);
  });

  it("answers any other conversation by email, at the contact's real address", () => {
    expect(
      hasReplyRecipient({
        channel: 'email',
        contactEmail: 'carla@example.com',
      }),
    ).toBe(true);
    for (const channel of ['email', 'Email', null, undefined]) {
      expect(hasReplyRecipient({ channel, contactEmail: '' })).toBe(false);
      expect(hasReplyRecipient({ channel, contactEmail: null })).toBe(false);
      expect(
        hasReplyRecipient({ channel, contactEmail: UNKNOWN_CONTACT_EMAIL }),
      ).toBe(false);
    }
  });
});
