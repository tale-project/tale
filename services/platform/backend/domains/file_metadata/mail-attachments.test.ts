// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  emailedAttachmentConversations,
  listMailAttachments,
} from './mail-attachments.ts';

/**
 * The listing and the provenance read behind `list kind="mail-attachment"`
 * and the chat tools' wrapping. What is pinned here is the SQL each one
 * sends — the conversation-state and binding predicates that the real
 * Postgres lanes prove end to end (`checkChatMailAttachmentListing`,
 * `checkEmailedAttachments`, in the Backend integration check).
 */

const ATTACHMENT = {
  ref: 's3:org-1/mail/cv.pdf',
  fileName: 'cv.pdf',
  contentType: 'application/pdf',
  size: 10,
  conversationId: 'conv-1',
  receivedAt: 1,
  ragStatus: 'completed',
};

/** Records every statement; an owner asks, one attachment is on file, and
 * the conversation read answers what `conversations` says it would. */
function fakeSql(
  log: { text: string; values: unknown[] }[],
  conversations: unknown[],
): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    log.push({ text, values });
    if (text.includes('FROM "member"')) {
      return Promise.resolve([{ role: 'owner' }]);
    }
    if (text.includes('FROM app.file_metadata')) {
      return Promise.resolve([ATTACHMENT]);
    }
    if (text.includes('FROM app.conversations')) {
      return Promise.resolve(conversations);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return tag as unknown as Sql;
}

describe('listMailAttachments', () => {
  it('reads each conversation only while it is live and not marked spam', async () => {
    const log: { text: string; values: unknown[] }[] = [];
    await listMailAttachments(fakeSql(log, []), {
      organizationId: 'org-1',
      userId: 'u-1',
      limit: 10,
    });
    const read = log.find((entry) =>
      entry.text.includes('FROM app.conversations'),
    );
    expect(read?.text).toContain(
      "coalesce(lifecycle_status, 'active') = 'active'",
    );
    expect(read?.text).toContain("status IS DISTINCT FROM 'spam'");
    expect(read?.values).toEqual(['org-1', ['conv-1']]);
  });

  it('lists nothing of a conversation that read leaves out — spam, the Trash, deleted — even for an owner', async () => {
    const result = await listMailAttachments(fakeSql([], []), {
      organizationId: 'org-1',
      userId: 'u-1',
      limit: 10,
    });
    expect(result.attachments).toEqual([]);
  });

  it('lists the attachment of a live conversation the caller may read', async () => {
    const result = await listMailAttachments(
      fakeSql(
        [],
        [{ id: 'conv-1', assigneeUserId: 'u-1', assigneeTeamId: null }],
      ),
      { organizationId: 'org-1', userId: 'u-1', limit: 10 },
    );
    expect(result.attachments.map((entry) => entry.ref)).toEqual([
      ATTACHMENT.ref,
    ]);
  });
});

describe('emailedAttachmentConversations', () => {
  it('names a ref mail only by a file row bound to a conversation and to no document', async () => {
    const log: { text: string; values: unknown[] }[] = [];
    await emailedAttachmentConversations(fakeSql(log, []), {
      organizationId: 'org-1',
      refs: [ATTACHMENT.ref],
    });
    const read = log[0];
    expect(read?.values[0]).toBe('org-1');
    expect(read?.text).toContain('conversation_id IS NOT NULL');
    expect(read?.text).toContain('document_id IS NULL');
  });

  it('reads nothing for no refs', async () => {
    const log: { text: string; values: unknown[] }[] = [];
    expect(
      await emailedAttachmentConversations(fakeSql(log, []), {
        organizationId: 'org-1',
        refs: [],
      }),
    ).toEqual([]);
    expect(log).toEqual([]);
  });
});
