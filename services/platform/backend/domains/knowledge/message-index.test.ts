// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `rag.index_message`: an inbound email's body indexed under its message
 * ref, stamped with its conversation, headed with its subject and sender —
 * and nothing indexed for what the corpus must not hold. An email has no
 * status row, so a refusal no retry can change ends the job quietly; only
 * a transient failure throws for the job's retry ladder.
 */

const mocks = vi.hoisted(() => ({
  readOrgEmbeddingConfig: vi.fn(),
  embedderForOrg: vi.fn(),
  classifyEmbeddingFailure: vi.fn(),
  getKnowledgePoolForOrg: vi.fn(),
  resolveOrgUrl: vi.fn(),
  indexWholeDocument: vi.fn(),
  resolveOrgSlug: vi.fn(),
  readGovernancePolicy: vi.fn(),
  isMessageCorpusLive: vi.fn(),
  directCallBlocked: vi.fn(),
  addJobInTx: vi.fn(),
}));

vi.mock('../../core/knowledge/connection.ts', () => ({
  readOrgEmbeddingConfig: mocks.readOrgEmbeddingConfig,
}));
vi.mock('../../core/knowledge/embedding.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../core/knowledge/embedding.ts')>();
  return {
    ...actual,
    embedderForOrg: mocks.embedderForOrg,
    classifyEmbeddingFailure: mocks.classifyEmbeddingFailure,
  };
});
vi.mock('../../core/knowledge/pool.ts', () => ({
  getKnowledgePoolForOrg: mocks.getKnowledgePoolForOrg,
  resolveOrgUrl: mocks.resolveOrgUrl,
}));
vi.mock('../../core/knowledge/indexing.ts', () => ({
  indexWholeDocument: mocks.indexWholeDocument,
}));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: mocks.resolveOrgSlug,
  readGovernancePolicy: mocks.readGovernancePolicy,
}));
vi.mock('./liveness.ts', () => ({
  isMessageCorpusLive: mocks.isMessageCorpusLive,
}));
vi.mock('./service.ts', () => ({ knowledgeShimHandlers: () => ({}) }));
vi.mock('../governance/direct-calls.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../governance/direct-calls.ts')>()),
  directCallBlocked: mocks.directCallBlocked,
}));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: mocks.addJobInTx }));

const { indexConversationMessage } = await import('./message-index.ts');
const { EmbeddingBudgetExceeded, EmbeddingNotConfigured } =
  await import('../../core/knowledge/embedding.ts');
const { EmbeddingDimensionMismatch, UnsupportedVectorWidth } =
  await import('../../core/knowledge/dimensions.ts');

const MESSAGE_ID = '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a';
const SENT_AT = Date.UTC(2026, 8, 20, 9, 30);
const HTML =
  '<html><body><p>Applying for the <b>field sales agent</b> role.</p></body></html>';

interface MessageRow {
  organizationId: string;
  conversationId: string;
  channel: string;
  direction: string;
  connectorName: string | null;
  content: string;
  metadata: unknown;
  sentAt: number;
  conversationStatus: string | null;
  conversationSubject: string | null;
  contactName: string | null;
  contactEmail: string | null;
}

function row(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    organizationId: 'org_1',
    conversationId: 'conv_1',
    channel: 'email',
    direction: 'inbound',
    connectorName: 'imap-smtp',
    content: HTML,
    metadata: {
      html: HTML,
      text: 'Applying for the field sales agent role.',
      subject: 'Application: field sales agent',
      from: [{ name: 'Bob Example', address: 'bob@example.test' }],
    },
    sentAt: SENT_AT,
    conversationStatus: 'open',
    conversationSubject: 'Application: field sales agent',
    contactName: 'Robert Example',
    contactEmail: 'bob@example.test',
    ...overrides,
  };
}

function fakeSql(
  message: MessageRow | null,
  options: { waitingJob?: boolean } = {},
): {
  sql: Sql;
  reads: unknown[][];
} {
  const reads: unknown[][] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    reads.push(values);
    // The queue, asked whether a job for the message already waits.
    if (strings.join('?').includes('FROM pgboss.job')) {
      return Promise.resolve(
        options.waitingJob === true ? [{ id: 'j-1' }] : [],
      );
    }
    return Promise.resolve(message === null ? [] : [message]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: fn as unknown as Sql, reads };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.resolveOrgSlug.mockResolvedValue('acme');
  mocks.readOrgEmbeddingConfig.mockResolvedValue({ model: 'embed' });
  mocks.embedderForOrg.mockResolvedValue({ dimensions: 3 });
  mocks.getKnowledgePoolForOrg.mockResolvedValue('pool');
  mocks.resolveOrgUrl.mockResolvedValue('postgres://corpus');
  mocks.readGovernancePolicy.mockResolvedValue(null);
  mocks.classifyEmbeddingFailure.mockReturnValue(null);
  mocks.indexWholeDocument.mockResolvedValue({
    fileId: `msg:${MESSAGE_ID}`,
    chunksWritten: 1,
    chunksTotal: 1,
    chunksStored: 1,
    partial: false,
  });
  mocks.isMessageCorpusLive.mockResolvedValue(true);
  mocks.directCallBlocked.mockResolvedValue(null);
  mocks.addJobInTx.mockResolvedValue('job-1');
});

function indexedArgs(): Record<string, unknown> {
  const call = mocks.indexWholeDocument.mock.calls[0];
  if (call === undefined) throw new Error('nothing was indexed');
  return call[0] as Record<string, unknown>;
}

describe('indexConversationMessage', () => {
  it('indexes the body under its message ref, stamped with its conversation', async () => {
    const { sql } = fakeSql(row());
    await indexConversationMessage(sql, MESSAGE_ID);

    const args = indexedArgs();
    expect(args).toMatchObject({
      sql: 'pool',
      dbUrl: 'postgres://corpus',
      orgSlug: 'acme',
      fileId: `msg:${MESSAGE_ID}`,
      filename: 'Application: field sales agent',
      title:
        'Application: field sales agent — from Bob Example <bob@example.test>',
      // The HTML body, read down to its text.
      text: 'Applying for the field sales agent role.',
      conversationId: 'conv_1',
      // Filed nowhere and in no team or project: the conversation is the
      // only scope a message has.
      folderPath: null,
      teamIds: null,
      projectId: null,
      sourceCreatedAt: new Date(SENT_AT),
      sourceModifiedAt: new Date(SENT_AT),
    });
    // The secret scan reads what would be indexed — the header included, so
    // a code in a subject line is refused like one in the body.
    expect(new TextDecoder().decode(args.bytes as Uint8Array)).toBe(
      'Application: field sales agent — from Bob Example <bob@example.test>\n\n' +
        'Applying for the field sales agent role.',
    );
    // No policy: the body and the header index as they are.
    expect(mocks.readGovernancePolicy).toHaveBeenCalledWith(
      'acme',
      'pii_config',
    );
    expect(args.piiConfig).toBeNull();
  });

  it('hands the organization’s PII policy to the indexer', async () => {
    // `prepareDocument` applies it to the body, the chunk header and the
    // stored name alike (indexing.test.ts); here the policy must reach it.
    mocks.readGovernancePolicy.mockResolvedValue({
      enabled: true,
      mode: 'mask',
      enabledPatterns: ['email'],
    });
    const { sql } = fakeSql(row());
    await indexConversationMessage(sql, MESSAGE_ID);
    expect(indexedArgs().piiConfig).toMatchObject({
      enabled: true,
      mode: 'mask',
      enabledPatterns: ['email'],
    });
  });

  it('asks the message’s own liveness after the corpus row is claimed', async () => {
    const { sql } = fakeSql(row());
    await indexConversationMessage(sql, MESSAGE_ID);
    const stillWanted = indexedArgs().stillWanted as () => Promise<boolean>;
    await expect(stillWanted()).resolves.toBe(true);
    expect(mocks.isMessageCorpusLive).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      messageId: MESSAGE_ID,
    });
  });

  it('never heads a chunk with the stored no-subject placeholder', async () => {
    const { sql } = fakeSql(
      row({
        metadata: { subject: '(no subject)', from: [] },
        conversationSubject: '(no subject)',
      }),
    );
    await indexConversationMessage(sql, MESSAGE_ID);
    // No subject, and the envelope names nobody: the contact names the mail.
    expect(indexedArgs()).toMatchObject({
      filename: 'Email from Robert Example',
      title: 'Email from Robert Example',
    });
  });

  it('prefers the reply’s own subject to its conversation’s', async () => {
    const { sql } = fakeSql(
      row({
        metadata: { subject: 'Re: availability', from: [] },
        conversationSubject: 'Application: field sales agent',
        contactName: null,
      }),
    );
    await indexConversationMessage(sql, MESSAGE_ID);
    expect(indexedArgs()).toMatchObject({
      filename: 'Re: availability',
      title: 'Re: availability — from bob@example.test',
    });
  });

  it('indexes nothing for a message that is gone, ours, mirrored, logged by hand, spam, or empty', async () => {
    // Markup and images alone: an HTML body with no text left to index.
    const pixelOnly = '<div><img src="https://example.test/x.gif"></div>';
    for (const message of [
      null,
      row({ direction: 'outbound' }),
      row({ channel: 'api' }),
      // A member's `POST /conversations/:id/messages` names no connector.
      row({ connectorName: null }),
      // Junk an outsider wrote is never sent to the embedding provider.
      row({ conversationStatus: 'spam' }),
      row({ content: pixelOnly, metadata: { html: pixelOnly, text: null } }),
      row({ content: ' \n ', metadata: { html: null, text: ' \n ' } }),
    ]) {
      const { sql } = fakeSql(message);
      await indexConversationMessage(sql, MESSAGE_ID);
    }
    expect(mocks.indexWholeDocument).not.toHaveBeenCalled();
    expect(mocks.embedderForOrg).not.toHaveBeenCalled();
  });

  it('reads nothing for an id no ref can carry', async () => {
    const { sql, reads } = fakeSql(row());
    await indexConversationMessage(sql, 'not an id');
    expect(reads).toEqual([]);
    expect(mocks.indexWholeDocument).not.toHaveBeenCalled();
  });

  it('ends quietly when the organization has no embedding model', async () => {
    mocks.embedderForOrg.mockRejectedValue(new EmbeddingNotConfigured('acme'));
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { sql } = fakeSql(row());
    await expect(indexConversationMessage(sql, MESSAGE_ID)).resolves.toBe(
      undefined,
    );
    expect(mocks.indexWholeDocument).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it('ends quietly on a refusal every retry would repeat', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sql } = fakeSql(row());
    mocks.indexWholeDocument.mockRejectedValueOnce(
      new EmbeddingDimensionMismatch(1536, 3, 'the embedding model'),
    );
    await expect(indexConversationMessage(sql, MESSAGE_ID)).resolves.toBe(
      undefined,
    );
    mocks.indexWholeDocument.mockRejectedValueOnce(
      new UnsupportedVectorWidth(1000, 'organization "acme"'),
    );
    await expect(indexConversationMessage(sql, MESSAGE_ID)).resolves.toBe(
      undefined,
    );
    const refused = new Error('401 invalid api key');
    mocks.indexWholeDocument.mockRejectedValueOnce(refused);
    mocks.classifyEmbeddingFailure.mockImplementation((error: unknown) =>
      error === refused ? 'credential' : null,
    );
    await expect(indexConversationMessage(sql, MESSAGE_ID)).resolves.toBe(
      undefined,
    );
    warn.mockRestore();
  });

  it('throws a transient failure so the job retries', async () => {
    const { sql } = fakeSql(row());
    mocks.indexWholeDocument.mockRejectedValueOnce(new Error('corpus down'));
    await expect(indexConversationMessage(sql, MESSAGE_ID)).rejects.toThrow(
      'corpus down',
    );
    const upstream = new Error('503 overloaded');
    mocks.indexWholeDocument.mockRejectedValueOnce(upstream);
    mocks.classifyEmbeddingFailure.mockReturnValue('upstream');
    await expect(indexConversationMessage(sql, MESSAGE_ID)).rejects.toBe(
      upstream,
    );
  });

  it('books the body’s embedding to the organization, request by request [GOV-R5]', async () => {
    const { sql } = fakeSql(row());
    await indexConversationMessage(sql, MESSAGE_ID);
    // Asked as its first request will be: a cent and a chunk's tokens.
    expect(mocks.directCallBlocked).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      subject: { userId: '__automation__', agentSlug: '__embedding__' },
      worstCase: { cents: 1, tokens: 1_024 },
    });
    expect(mocks.embedderForOrg).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ meter: expect.any(Object) }),
    );
  });

  it('waits for a usage limit: its job comes back later, nothing read meanwhile [GOV-R4] [KNOW-R18]', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const resetsAt = Date.now() + 10 * 60_000;
    mocks.directCallBlocked.mockResolvedValueOnce({
      scope: 'org',
      code: 'COST_LIMIT',
      period: 'daily',
      used: 100,
      limit: 100,
      reason: 'x',
      resetsAt,
    });
    const { sql } = fakeSql(row());
    await expect(
      indexConversationMessage(sql, MESSAGE_ID),
    ).resolves.toBeUndefined();

    expect(mocks.embedderForOrg).not.toHaveBeenCalled();
    expect(mocks.addJobInTx).toHaveBeenCalledWith(
      sql,
      'rag.index_message',
      { messageId: MESSAGE_ID },
      {
        // The period resets sooner than an hour: just after it.
        startAfter: new Date(resetsAt + 60_000),
      },
    );

    mocks.indexWholeDocument.mockRejectedValueOnce(
      new EmbeddingBudgetExceeded('Usage limit reached.'),
    );
    await expect(
      indexConversationMessage(sql, MESSAGE_ID),
    ).resolves.toBeUndefined();
    expect(mocks.addJobInTx).toHaveBeenCalledTimes(2);
  });

  it('leaves the wait to a job for the message that is already queued', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    mocks.directCallBlocked.mockResolvedValueOnce({
      scope: 'org',
      code: 'COST_LIMIT',
      period: 'monthly',
      used: 100,
      limit: 100,
      reason: 'x',
      resetsAt: Date.now() + 86_400_000,
    });
    const { sql } = fakeSql(row(), { waitingJob: true });

    await expect(
      indexConversationMessage(sql, MESSAGE_ID),
    ).resolves.toBeUndefined();

    expect(mocks.embedderForOrg).not.toHaveBeenCalled();
    expect(mocks.addJobInTx).not.toHaveBeenCalled();
  });

  it('throws once pg-boss gave up on the job, whatever the cause', async () => {
    const controller = new AbortController();
    controller.abort();
    mocks.embedderForOrg.mockRejectedValue(new EmbeddingNotConfigured('acme'));
    const { sql } = fakeSql(row());
    await expect(
      indexConversationMessage(sql, MESSAGE_ID, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(EmbeddingNotConfigured);
  });
});
