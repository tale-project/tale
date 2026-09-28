import { describe, expect, it } from 'vitest';

import { groupMessagesByDate } from '../../utils/conversation/date-utils';
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

/**
 * A Google-style HTML email's `<style>` reset block routinely runs past 200
 * characters. Cutting the raw markup at that length first, the way the row
 * preview used to, severs the block's closing tag — the client's tag
 * stripper can then never find it, and the row shows a dangling CSS rule
 * (`.awl a {color: #FFFFFF; te`) instead of the message's real text.
 */
describe('HTML message previews', () => {
  it('strips a long style block before truncating to 200 chars', () => {
    const style = `<style type="text/css">${'.awl a {color: #FFFFFF; text-decoration: none;} '.repeat(10)}</style>`;
    const html = `${style}<body><p>Your account was accessed from a new device.</p></body>`;
    const item = projectConversationItem({
      conversation: {
        id: 'thread',
        organizationId: 'org',
        channel: 'email',
        createdAt: 0,
      },
      contact: null,
      messages: [
        {
          id: 'm0',
          direction: 'inbound',
          content: html,
          createdAt: 0,
          metadata: { html },
        },
      ],
    });
    expect(item.lastMessagePreview).toBe(
      'Your account was accessed from a new device.',
    );
    expect(item.lastMessagePreview).not.toContain('{color');
    expect(item.lastMessagePreview).not.toContain('<style');
  });

  it("doesn't pad a layout-table email with empty pipe columns", () => {
    const html =
      '<table><tr><td><img src="logo.png"></td><td></td></tr></table>' +
      '<table><tr><td><p>You allowed Semrush access to some of your Google data.</p></td></tr></table>';
    const item = projectConversationItem({
      conversation: {
        id: 'thread',
        organizationId: 'org',
        channel: 'email',
        createdAt: 0,
      },
      contact: null,
      messages: [
        {
          id: 'm0',
          direction: 'inbound',
          content: html,
          createdAt: 0,
          metadata: { html },
        },
      ],
    });
    expect(item.lastMessagePreview).toBe(
      'You allowed Semrush access to some of your Google data.',
    );
    expect(item.lastMessagePreview).not.toContain('|');
  });
});

/**
 * A reply queued for an API app has no send time until the app acknowledges
 * delivery, and the thread drops any message without a timestamp. An empty
 * timestamp therefore hid the reply, its undo countdown and, after a terminal
 * failure, its Retry/Discard, until the acknowledgement arrived.
 */
describe('message timestamps', () => {
  const QUEUED_AT = Date.UTC(2026, 8, 24, 9, 30);

  function project(message: Record<string, unknown>) {
    const item = projectConversationItem({
      conversation: {
        id: 'thread',
        organizationId: 'org',
        channel: 'api',
        createdAt: 0,
      },
      contact: null,
      messages: [
        {
          id: 'reply',
          direction: 'outbound',
          content: 'On its way.',
          createdAt: QUEUED_AT,
          ...message,
        },
      ],
    });
    const messages = item.messages as { timestamp: string; status: string }[];
    return { item, message: messages[0] };
  }

  it('dates a queued reply with no send time by when it was written', () => {
    const { item, message } = project({
      deliveryState: 'queued',
      sentAt: null,
      metadata: { scheduledSendAt: QUEUED_AT + 10_000 },
    });
    expect(message).toMatchObject({
      status: 'queued',
      timestamp: new Date(QUEUED_AT).toISOString(),
    });
    expect(item.messages).toMatchObject([
      { scheduledSendAt: QUEUED_AT + 10_000 },
    ]);
    // The thread renders only what it can group by date.
    const groups = groupMessagesByDate(
      item.messages as { id: string; timestamp: string }[],
    );
    expect(groups.flatMap((group) => group.messages)).toHaveLength(1);
  });

  it('keeps a failed reply dated, so its retry can be reached', () => {
    const { item, message } = project({
      deliveryState: 'failed',
      sentAt: null,
      metadata: { error: 'App refused the reply' },
    });
    expect(message?.timestamp).toBe(new Date(QUEUED_AT).toISOString());
    expect(item.messages).toMatchObject([
      { status: 'failed', errorMessage: 'App refused the reply' },
    ]);
  });

  it('prefers the send time, then the delivery time, over the write time', () => {
    const sent = QUEUED_AT + 60_000;
    const delivered = QUEUED_AT + 30_000;
    expect(
      project({ sentAt: sent, deliveredAt: delivered }).message?.timestamp,
    ).toBe(new Date(sent).toISOString());
    expect(
      project({ sentAt: null, deliveredAt: delivered }).message?.timestamp,
    ).toBe(new Date(delivered).toISOString());
  });
});

/**
 * One stored stamp no `Date` can hold made `toISOString()` throw, and the
 * listing projects every row of its page, so the whole Inbox list of the
 * organization answered 500. `9e15` is a safe integer: the doors' `.int()`
 * let it in. The projection dates such a row by its creation time instead.
 */
describe('stamps no Date can hold', () => {
  const WRITTEN_AT = Date.UTC(2026, 8, 27, 8, 15);
  const CREATED_AT = Date.UTC(2026, 8, 27, 8);
  const OUT_OF_RANGE = 9e15;

  function project(
    conversation: { lastMessageAt?: number; createdAt?: number },
    messages: Record<string, unknown>[],
  ) {
    const item = projectConversationItem({
      conversation: {
        id: 'thread',
        organizationId: 'org',
        channel: 'email',
        createdAt: CREATED_AT,
        ...conversation,
      },
      contact: null,
      messages: messages.map((message, index) => ({
        id: `m${index}`,
        direction: 'inbound',
        content: 'Hello',
        createdAt: WRITTEN_AT,
        ...message,
      })),
    });
    return {
      item,
      messages: item.messages as { id: string; timestamp: string }[],
    };
  }

  it('dates a message with sentAt: 9e15 by when its row was written', () => {
    const { messages } = project({}, [{ sentAt: OUT_OF_RANGE }]);
    const timestamp = messages[0]?.timestamp ?? '';
    expect(timestamp).toBe(new Date(WRITTEN_AT).toISOString());
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
    // The thread renders only what it can group by date.
    expect(
      groupMessagesByDate(messages).flatMap((group) => group.messages),
    ).toHaveLength(1);
  });

  it('passes over only the stamp it cannot hold', () => {
    const delivered = WRITTEN_AT - 60_000;
    const { messages } = project({}, [
      { sentAt: OUT_OF_RANGE, deliveredAt: delivered },
      { sentAt: -1, deliveredAt: OUT_OF_RANGE },
    ]);
    expect(messages.map((message) => message.timestamp)).toEqual([
      new Date(delivered).toISOString(),
      new Date(WRITTEN_AT).toISOString(),
    ]);
  });

  it('dates the row by its newest message when its lastMessageAt cannot be held', () => {
    // `lastMessageAt` only ever advances, so the poisoned message's stamp
    // is copied onto its conversation for good.
    const { item } = project({ lastMessageAt: OUT_OF_RANGE }, [
      { sentAt: OUT_OF_RANGE },
    ]);
    expect(item.last_message_at).toBe(new Date(WRITTEN_AT).toISOString());
    expect(item).not.toHaveProperty('lastMessageAt');
  });

  it('dates a row without messages by its creation', () => {
    const { item } = project({ lastMessageAt: OUT_OF_RANGE }, []);
    expect(item.last_message_at).toBe(new Date(CREATED_AT).toISOString());
  });

  it('renders a creation time no Date can hold as the epoch rather than throwing', () => {
    const epoch = new Date(0).toISOString();
    const { item, messages } = project({ createdAt: OUT_OF_RANGE }, [
      { createdAt: -OUT_OF_RANGE },
    ]);
    expect(item).toMatchObject({
      created_at: epoch,
      updated_at: epoch,
      contact: { created_at: epoch },
    });
    expect(messages[0]?.timestamp).toBe(epoch);
    const withContact = projectConversationItem({
      conversation: { id: 'thread', organizationId: 'org', createdAt: 0 },
      contact: { id: 'client', createdAt: OUT_OF_RANGE },
      messages: [],
    });
    expect(withContact.contact).toMatchObject({ created_at: epoch });
  });
});
