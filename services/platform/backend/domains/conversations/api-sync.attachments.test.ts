// @vitest-environment node

/**
 * A `storageId` the store guard refuses — malformed (not an `s3:<key>`
 * the upload door handed out), or a key outside this organization's
 * namespace — is not a staged attachment, so a snapshot and a native reply
 * naming one answer the documented 400 `ATTACHMENT_NOT_STAGED`. The
 * regression under test: the guard's own `BLOB_REF_INVALID` (403) reached
 * the wire — a code the contract never declared — while only a
 * well-formed-but-unstaged ref took the documented lane.
 */

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { FileError } from '../files/service.ts';
import {
  apiSnapshotSchema,
  queueApiReply,
  synchronizeConversation,
} from './api-sync.ts';

const { statOrgBlob } = vi.hoisted(() => ({ statOrgBlob: vi.fn() }));
vi.mock('../files/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../files/service.ts')>()),
  statOrgBlob,
}));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));

/** The one read before the store is asked — the receipted rows — answers
 * nothing; every refusal under test fires before any transaction opens. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
const sql = (() => Promise.resolve([])) as unknown as Sql;

const viewer = { organizationId: 'org-1', userId: 'user-1', role: 'admin' };

const attachment = {
  storageId: 'e4-crm-fake-storage-id-a',
  fileName: 'x.txt',
  contentType: 'text/plain',
  size: 10,
};

const snapshot = apiSnapshotSchema.parse({
  source: 'e4-crm-src',
  externalId: 'e4-crm-conv-2',
  externalContactId: 'e4-crm-conv-contact-1',
  version: 1,
  subject: 'has attachment',
  status: 'open',
  messages: [
    {
      externalId: 'e4-crm-msg-a',
      content: 'has attachment',
      isCustomer: true,
      authorName: 'e4-crm-tester',
      createdAt: 1_789_230_000_000,
      attachments: [attachment],
    },
  ],
});

const reply = {
  organizationId: 'org-1',
  conversationId: 'c-1',
  content: '<p>Office reply</p>',
  body: 'Office reply',
  attachments: [attachment],
  actor: { userId: 'user-1', email: 'office@example.com' },
  availableAt: 0,
};

const refusedRef = () =>
  new FileError('BLOB_REF_INVALID', 'Invalid blob reference', 403);

describe('a storageId the store guard refuses', () => {
  it.each([
    ['a snapshot', () => synchronizeConversation(sql, viewer, snapshot)],
    ['a native reply', () => queueApiReply(sql, reply)],
  ])(
    '%s answers ATTACHMENT_NOT_STAGED, never the guard’s 403',
    async (_lane, run) => {
      statOrgBlob.mockRejectedValueOnce(refusedRef());
      await expect(run()).rejects.toMatchObject({
        name: 'ConversationError',
        code: 'ATTACHMENT_NOT_STAGED',
        status: 400,
      });
    },
  );

  it('keeps the documented lane for a well-formed ref that never landed', async () => {
    statOrgBlob.mockResolvedValueOnce(null);
    await expect(
      synchronizeConversation(sql, viewer, snapshot),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_STAGED', status: 400 });
  });

  it('lets every other store failure through untouched', async () => {
    statOrgBlob.mockRejectedValueOnce(
      new FileError('OBJECT_STORE_UNCONFIGURED', 'No object store', 503),
    );
    await expect(
      synchronizeConversation(sql, viewer, snapshot),
    ).rejects.toMatchObject({ code: 'OBJECT_STORE_UNCONFIGURED', status: 503 });
  });
});
