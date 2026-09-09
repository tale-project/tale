import { describe, expect, it } from 'vitest';

import { projectConversationItem } from './conversation-item';

describe('API contact presentation', () => {
  it('preserves a real app contact without inventing an email address', () => {
    const result = projectConversationItem({
      conversation: {
        id: 'thread',
        organizationId: 'org',
        channel: 'api',
        contactId: 'client',
        createdAt: 0,
      },
      contact: { id: 'client', name: 'Alpine AG', email: '', createdAt: 0 },
      messages: [],
    });
    expect(result.contact).toMatchObject({ name: 'Alpine AG', email: '' });
    expect(result.channel).toBe('api');
    const missing = projectConversationItem({
      conversation: {
        id: 'thread',
        organizationId: 'org',
        channel: 'api',
        createdAt: 0,
      },
      contact: null,
      messages: [],
    });
    expect(missing.contact).toMatchObject({ email: '' });
  });
});
