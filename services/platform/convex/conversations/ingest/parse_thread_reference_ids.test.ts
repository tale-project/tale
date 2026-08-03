import { describe, expect, it } from 'vitest';

import { parseThreadReferenceIds } from './parse_thread_reference_ids';
import type { EmailType } from './types';

function email(overrides: Partial<EmailType> = {}): EmailType {
  return {
    uid: 1,
    messageId: 'msg@example.com',
    from: [{ address: 'sender@example.com' }],
    to: [{ address: 'recipient@example.com' }],
    subject: 'Subject',
    date: '2026-07-01T10:00:00.000Z',
    flags: [],
    ...overrides,
  };
}

describe('parseThreadReferenceIds', () => {
  it('returns empty when only references are present (no in-reply-to)', () => {
    const ids = parseThreadReferenceIds(
      email({
        headers: {
          'message-id': '<child@example.com>',
          'in-reply-to': '',
          references: '<root@example.com>',
        },
      }),
    );

    expect(ids).toEqual([]);
  });

  it('returns in-reply-to before references, direct parent first', () => {
    const ids = parseThreadReferenceIds(
      email({
        headers: {
          'message-id': '<child@example.com>',
          'in-reply-to': '<parent@example.com>',
          references: '<root@example.com> <parent@example.com>',
        },
      }),
    );

    expect(ids).toEqual(['parent@example.com', 'root@example.com']);
  });

  it('deduplicates repeated IDs', () => {
    const ids = parseThreadReferenceIds(
      email({
        headers: {
          'message-id': '<child@example.com>',
          'in-reply-to': '<parent@example.com>',
          references: '<root@example.com> <parent@example.com>',
        },
      }),
    );

    expect(ids.filter((id) => id === 'parent@example.com')).toHaveLength(1);
  });

  it('returns empty when no threading headers', () => {
    expect(parseThreadReferenceIds(email())).toEqual([]);
  });
});
