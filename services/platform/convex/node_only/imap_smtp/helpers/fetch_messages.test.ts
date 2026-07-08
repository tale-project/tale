import { beforeEach, describe, expect, it, vi } from 'vitest';

// Shared, hoisted state the ImapFlow mock reads from. Lets each test configure
// the mailbox size and inspect the exact FETCH ranges the code requested.
const h = vi.hoisted(() => ({
  sentExists: 0,
  fetchRanges: [] as unknown[],
  searchResult: [] as number[],
  listResult: [
    { path: 'INBOX', flags: new Set<string>() },
    { path: 'Sent', flags: new Set<string>(), specialUse: '\\Sent' },
  ],
}));

vi.mock('imapflow', () => {
  class ImapFlowMock {
    mailbox: { exists: number; path: string } | undefined;

    async connect() {}
    async list() {
      return h.listResult;
    }
    async getMailboxLock(path: string) {
      this.mailbox = { exists: h.sentExists, path };
      return { release() {} };
    }
    async search() {
      return h.searchResult;
    }
    async *fetch(range: unknown) {
      h.fetchRanges.push(range);
      // UID fetch: an explicit array of UIDs.
      if (Array.isArray(range)) {
        for (const uid of range) {
          yield { uid, flags: new Set<string>(), source: Buffer.from(`uid-${uid}`) };
        }
        return;
      }
      // Sequence range `${start}:*` — the only valid shape the code should emit.
      const match = /^(\d+):\*$/.exec(String(range));
      if (!match) return; // anything else (e.g. the old `*:-25`) fetches nothing
      const start = Number(match[1]);
      const exists = this.mailbox?.exists ?? 0;
      for (let seq = start; seq <= exists; seq += 1) {
        yield {
          uid: 1000 + seq,
          flags: new Set<string>(),
          source: Buffer.from(`msg-${seq}`),
        };
      }
    }
    async logout() {}
  }
  return { ImapFlow: ImapFlowMock };
});

vi.mock('mailparser', () => ({
  simpleParser: vi.fn(async () => ({})),
}));

vi.mock('./map_to_email_type', () => ({
  mapToEmailType: (uid: number) => ({
    uid,
    messageId: `<${uid}@test>`,
    from: [],
    to: [],
    subject: 's',
    date: undefined,
    flags: [],
  }),
}));

import { fetchMessages } from './fetch_messages';

const imap = {
  host: 'imap.example.com',
  port: 993,
  secure: true,
  user: 'hello@example.com',
  password: 'secret',
};

beforeEach(() => {
  h.fetchRanges = [];
  h.searchResult = [];
  h.sentExists = 0;
});

describe('fetchMessages — sent folder recent fetch', () => {
  it('first run: requests a valid `start:*` range, never `*:-N`', async () => {
    h.sentExists = 3;

    const result = await fetchMessages({ imap, mailbox: 'sent', maxResults: 25 });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(3);
    // The regression: the old code emitted "*:-25"; the fix emits "1:*".
    expect(h.fetchRanges).toContain('1:*');
    for (const range of h.fetchRanges) {
      expect(String(range)).not.toMatch(/\*:-/);
    }
  });

  it('first run: caps to the last maxResults on a large folder', async () => {
    h.sentExists = 30;

    const result = await fetchMessages({ imap, mailbox: 'sent', maxResults: 25 });

    expect(result.data).toHaveLength(25);
    // start = 30 - 25 + 1 = 6
    expect(h.fetchRanges).toContain('6:*');
  });

  it('first run: empty Sent folder fetches nothing (no invalid range sent)', async () => {
    h.sentExists = 0;

    const result = await fetchMessages({ imap, mailbox: 'sent', maxResults: 25 });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    // exists === 0 short-circuits before any FETCH is issued.
    expect(h.fetchRanges).toHaveLength(0);
  });

  it('incremental: falls back to a valid `start:*` range when SEARCH is empty', async () => {
    h.sentExists = 30;
    h.searchResult = []; // Sent folders often return empty SEARCH

    const result = await fetchMessages({
      imap,
      mailbox: 'sent',
      since: 1_700_000_000_000,
      maxResults: 25,
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(25);
    expect(h.fetchRanges).toContain('6:*');
    for (const range of h.fetchRanges) {
      expect(String(range)).not.toMatch(/\*:-/);
    }
  });
});
