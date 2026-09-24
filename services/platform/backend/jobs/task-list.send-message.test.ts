/**
 * The send job re-validates its payload at the boundary. A field the schema
 * does not name is dropped by the parse, and the mailbox a send must leave
 * through was one of them: every reply resolved the connector's default
 * credential, whatever mailbox the thread recorded.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runSendMessageJob } = vi.hoisted(() => ({
  runSendMessageJob: vi.fn(async () => undefined),
}));

vi.mock('../domains/conversations/send.ts', () => ({ runSendMessageJob }));

import { createTaskList } from './task-list.ts';

const SQL = {} as Sql;

const PAYLOAD = {
  organizationId: 'o1',
  messageId: 'm1',
  connectorName: 'imap-smtp',
  to: ['carla@ext.test'],
  subject: 'Re: Order 42',
  body: '<p>On its way.</p>',
};

describe("conversation.send_message's payload", () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the mailbox the send must leave through', async () => {
    const handler = createTaskList({ sql: SQL })['conversation.send_message'];
    await handler?.({ ...PAYLOAD, credentialId: 'cred-b' });
    expect(runSendMessageJob).toHaveBeenCalledWith(
      SQL,
      expect.objectContaining({ credentialId: 'cred-b' }),
    );
  });

  it('sends without one when the payload names none', async () => {
    const handler = createTaskList({ sql: SQL })['conversation.send_message'];
    await handler?.(PAYLOAD);
    expect(runSendMessageJob).toHaveBeenCalledWith(
      SQL,
      expect.not.objectContaining({ credentialId: expect.anything() }),
    );
  });
});
