/**
 * The external id stamped on a sent row is the RFC Message-ID, so a customer's
 * reply threads back onto the conversation. Gmail's send returns only its own
 * API id, so the sent message is read back once to recover the RFC id; the
 * other connectors keep whatever the send output already carried.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runConnectorAction } = vi.hoisted(() => ({
  runConnectorAction: vi.fn(),
}));

vi.mock('../connectors/service.ts', () => ({ runConnectorAction }));

import { resolveSentExternalMessageId } from './send.ts';

const SQL = {} as never;

describe('resolveSentExternalMessageId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads a Gmail send back and stamps its RFC Message-ID', async () => {
    runConnectorAction.mockResolvedValue({
      status: 'ok',
      output: {
        message: {
          id: 'gmail-api-id-xyz',
          payload: {
            headers: [
              { name: 'Message-ID', value: '<sent-42@mail.gmail.com>' },
            ],
          },
        },
      },
    });

    const id = await resolveSentExternalMessageId(SQL, {
      organizationId: 'o1',
      connector: 'gmail',
      connectorName: 'gmail',
      output: { id: 'gmail-api-id-xyz', threadId: 't1' },
    });

    expect(id).toBe('sent-42@mail.gmail.com');
    expect(runConnectorAction).toHaveBeenCalledWith(
      SQL,
      expect.objectContaining({
        connector: 'gmail',
        action: 'get_message',
        input: { messageId: 'gmail-api-id-xyz' },
      }),
    );
  });

  it('keeps the Gmail API id when the read-back fails', async () => {
    runConnectorAction.mockRejectedValue(new Error('rate limited'));
    const id = await resolveSentExternalMessageId(SQL, {
      organizationId: 'o1',
      connector: 'gmail',
      connectorName: 'gmail',
      output: { id: 'gmail-api-id-xyz' },
    });
    expect(id).toBe('gmail-api-id-xyz');
  });

  it('does not read back for imap-smtp — its send already returns the RFC id', async () => {
    const id = await resolveSentExternalMessageId(SQL, {
      organizationId: 'o1',
      connector: 'imap-smtp',
      connectorName: 'imap-smtp',
      output: { messageId: '<sent-7@mail.example.com>' },
    });
    expect(id).toBe('sent-7@mail.example.com');
    expect(runConnectorAction).not.toHaveBeenCalled();
  });
});
