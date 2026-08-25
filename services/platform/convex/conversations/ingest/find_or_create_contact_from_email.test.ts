import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { findOrCreateContactFromEmail } from './find_or_create_contact_from_email';
import type { EmailType } from './types';

describe('findOrCreateContactFromEmail', () => {
  it('creates inbound contacts with source conversation, not manual_import', async () => {
    const runMutation = vi.fn(async () => ({
      contactId: 'cont_1' as Id<'contacts'>,
      created: true,
    }));
    const ctx = { runMutation } as unknown as ActionCtx;

    const email: EmailType = {
      uid: 1,
      from: [{ address: 'alice@example.com', name: 'Alice' }],
      to: [{ address: 'support@org.com', name: 'Support' }],
      date: '2026-08-25T10:00:00.000Z',
      subject: 'Hello',
      messageId: '<msg-1@example.com>',
      flags: [],
    };

    const result = await findOrCreateContactFromEmail(
      ctx,
      'org_1',
      email,
      'inbound',
    );

    expect(result).toEqual({
      contactId: 'cont_1',
      email: 'alice@example.com',
    });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org_1',
        email: 'alice@example.com',
        name: 'Alice',
        source: 'conversation',
        metadata: {
          createdFrom: 'email_sync',
          firstEmailDate: '2026-08-25T10:00:00.000Z',
        },
      }),
    );
  });

  it('creates outbound contacts with source conversation and sent_email_sync', async () => {
    const runMutation = vi.fn(async () => ({
      contactId: 'cont_2' as Id<'contacts'>,
      created: true,
    }));
    const ctx = { runMutation } as unknown as ActionCtx;

    const email: EmailType = {
      uid: 2,
      from: [{ address: 'support@org.com', name: 'Support' }],
      to: [{ address: 'bob@example.com', name: 'Bob' }],
      date: '2026-08-25T11:00:00.000Z',
      subject: 'Re: Hello',
      messageId: '<msg-2@example.com>',
      flags: [],
    };

    await findOrCreateContactFromEmail(ctx, 'org_1', email, 'outbound');

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        email: 'bob@example.com',
        name: 'Bob',
        source: 'conversation',
        metadata: expect.objectContaining({
          createdFrom: 'sent_email_sync',
        }),
      }),
    );
  });
});
