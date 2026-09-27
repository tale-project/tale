// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  conversationReadAdapters,
  conversationWriteAdapters,
} from './conversations';

const ctx = { organizationId: 'org1' };
const NAME = 'conversations/queries:approxCountConversationsByStatus';
const UNREAD = 'conversations/queries:countUnreadConversations';
const BODY = { byStatus: { open: 3, closed: 7 }, unread: 5 };

/**
 * `/conversations/counts` answers every status AND the unread total in one
 * body, and the Inbox prefetches a badge per status while the rail reads the
 * unread chip: keyed on the narrowing, one cold load fetched the same body
 * five times. Every read keys on the fetch and narrows in `select`, so
 * react-query issues one request and all five read it.
 */
describe('the conversation count badges', () => {
  it('share one cache entry per connector, whatever status they read', () => {
    const keys = ['open', 'closed', 'spam', 'archived'].map(
      (status) => conversationReadAdapters[NAME]?.({ status }, ctx)?.queryKey,
    );
    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(1);
    const filtered = conversationReadAdapters[NAME]?.(
      { status: 'open', connectorName: 'gmail' },
      ctx,
    )?.queryKey;
    expect(JSON.stringify(filtered)).not.toBe(JSON.stringify(keys[0]));
  });

  it('narrow the shared body to their own status', () => {
    const read = conversationReadAdapters[NAME]?.({ status: 'closed' }, ctx);
    expect(read?.select?.(BODY)).toBe(7);
    expect(read?.select?.({ byStatus: { open: 3 }, unread: 0 })).toBe(0);
  });

  it('share that entry with the rail’s unread chip', () => {
    const status = conversationReadAdapters[NAME]?.({ status: 'open' }, ctx);
    const unread = conversationReadAdapters[UNREAD]?.({}, ctx);
    expect(JSON.stringify(unread?.queryKey)).toBe(
      JSON.stringify(status?.queryKey),
    );
  });

  it('narrow the shared body to the unread total', () => {
    const read = conversationReadAdapters[UNREAD]?.({}, ctx);
    expect(read?.select?.(BODY)).toBe(5);
    // Not the open-status count, which is the neighbouring number in the
    // same body and the one a wrong key would silently return.
    expect(read?.select?.(BODY)).not.toBe(BODY.byStatus.open);
  });

  it('keys the unread chip per connector, like the status badges', () => {
    const all = conversationReadAdapters[UNREAD]?.({}, ctx)?.queryKey;
    const gmail = conversationReadAdapters[UNREAD]?.(
      { connectorName: 'gmail' },
      ctx,
    )?.queryKey;
    expect(JSON.stringify(gmail)).not.toBe(JSON.stringify(all));
  });
});

/**
 * The composer offers Send for files with no text, and hands the send an
 * empty body. The adapter read that `''` as a missing argument and threw
 * before any request, so an attachment-only email always read "Send failed".
 * An empty body is a real one when files go with it; with nothing at all
 * there is no email, and nothing is sent.
 */
describe('an outbound email that carries only files', () => {
  const REPLY = 'conversations/mutations:sendMessageViaConnector';
  const COMPOSE = 'conversations/mutations:composeEmailConversation';
  const FILE = {
    storageId: 'blob-1',
    fileName: 'invoice.pdf',
    contentType: 'application/pdf',
    size: 1024,
  };
  const COMPOSE_ARGS = {
    organizationId: 'org1',
    contactId: 'ct1',
    connectorName: 'imap-smtp',
    subject: 'Invoice',
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** `run` as the mutation hook calls it: a throw while the request is built
   * rejects, the same as a refused request. */
  async function run(name: string, args: Record<string, unknown>) {
    return conversationWriteAdapters[name]?.run(args, ctx);
  }

  function sentBody(fetchSpy: { mock: { calls: unknown[][] } }): unknown {
    const init = fetchSpy.mock.calls[0]?.[1];
    const body =
      typeof init === 'object' && init !== null && 'body' in init
        ? init.body
        : undefined;
    return typeof body === 'string' ? JSON.parse(body) : undefined;
  }

  it('sends a reply with an empty body beside its files', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ messageId: 'm1' })));

    await expect(
      run(REPLY, { conversationId: 'c1', content: '', attachments: [FILE] }),
    ).resolves.toBe('m1');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/conversations/c1/reply'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(sentBody(fetchSpy)).toEqual({ content: '', attachments: [FILE] });
  });

  it('sends a new email with an empty body beside its files', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ conversationId: 'c-new', messageId: 'm1' }),
        ),
      );

    await run(COMPOSE, { ...COMPOSE_ARGS, content: '', attachments: [FILE] });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/conversations/compose'),
      expect.anything(),
    );
    expect(sentBody(fetchSpy)).toMatchObject({
      content: '',
      attachments: [FILE],
    });
  });

  it.each([
    ['no attachments', {}],
    ['an empty attachment list', { attachments: [] }],
  ])('refuses an empty body with %s, sending nothing', async (_, extra) => {
    const fetchSpy = vi.spyOn(window, 'fetch');

    await expect(
      run(REPLY, { conversationId: 'c1', content: '', ...extra }),
    ).rejects.toThrow('Missing content');
    await expect(
      run(COMPOSE, { ...COMPOSE_ARGS, content: '', ...extra }),
    ).rejects.toThrow('Missing content');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still refuses a body that is not text, files or not', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch');

    await expect(
      run(REPLY, { conversationId: 'c1', attachments: [FILE] }),
    ).rejects.toThrow('Missing content');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
