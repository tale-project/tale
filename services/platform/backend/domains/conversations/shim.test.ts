/**
 * A heal that says it healed must have written. The sync's IMAP fromAddress
 * heal patches credential `config` through `patchCredentialInternal`; the shim
 * used to `.loose()`-parse the call and forward only the two watermark fields,
 * so `config` was silently dropped — the mirror never landed and the drift was
 * re-detected (and "mirrored" re-logged) on every pass.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  reachableHandlerNames,
  unansweredHandlerNames,
} from '../../lib/ctx-shim-reachability.ts';

const {
  patchMailSyncWatermarks,
  patchCredentialConfigInternal,
  resolveCredentialRowForShim,
  createConversation,
  addMessageToConversation,
  markRagQueued,
  addJobInTx,
  findOrCreateContactByEmail,
} = vi.hoisted(() => ({
  patchMailSyncWatermarks: vi.fn(async () => undefined),
  patchCredentialConfigInternal: vi.fn(async () => undefined),
  resolveCredentialRowForShim: vi.fn(async () => null),
  createConversation: vi.fn<() => Promise<string>>(async () => 'c-new'),
  addMessageToConversation: vi.fn<
    () => Promise<{ messageId: string; conversationId: string }>
  >(async () => ({ messageId: 'm-new', conversationId: 'c-new' })),
  markRagQueued: vi.fn(async () => undefined),
  addJobInTx: vi.fn(async () => 'job-1'),
  findOrCreateContactByEmail: vi.fn(async () => ({
    contactId: 'ct-1',
    created: true,
  })),
}));

vi.mock('../connector_credentials/service.ts', () => ({
  listActiveCredentials: vi.fn(),
  patchMailSyncWatermarks,
  patchCredentialConfigInternal,
  resolveCredentialRowForShim,
}));
vi.mock('../files/service.ts', () => ({
  putOrgBlobBytes: vi.fn(),
  registerUploadedBytes: vi.fn(),
}));
vi.mock('./service.ts', () => ({
  createConversation,
  addMessageToConversation,
}));
vi.mock('./routing.ts', () => ({
  applyAddressRouting: vi.fn(async () => undefined),
}));
vi.mock('../knowledge/service.ts', () => ({ markRagQueued }));
vi.mock('../contacts/service.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../contacts/service.ts')>();
  return { ...actual, findOrCreateContactByEmail };
});
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx }));

import { conversationShimHandlers } from './shim.ts';

const SQL = {} as never;

/**
 * The EXHAUSTIVENESS gate for the mailbox sync lane's ctx dispatch — the twin
 * of `domains/chat/shim.test.ts` and `domains/sandbox/shim.test.ts`, on the
 * same shared walk. `pgConversationStore` (connectors/service.ts) hands the
 * reused 0.4 `syncMailbox` + `ingest/*` a ctx shim built from
 * `conversationShimHandlers` alone, and the shim fails LOUD on a name it has
 * no handler for — at the operator's next mail sync. Before this gate the
 * map carried three handlers nothing named and 0.4 code named one handler
 * the map never had.
 */
const SYNC_DISPATCH = {
  entryPoints: ['core/conversations/sync_mailbox.ts'],
};

describe('conversationShimHandlers', () => {
  // The factory only closes over `sql` and the connector callback; no handler
  // runs until it is called, so stand-ins are enough to enumerate the map.
  const handlers = conversationShimHandlers(SQL, () => {
    throw new Error('no connector calls in this test');
  });

  it('answers every internal function a mailbox sync can reach', () => {
    expect(unansweredHandlerNames(handlers, SYNC_DISPATCH)).toEqual([]);
  });

  it('carries no handler the sync lane never names', () => {
    // The inverse: an orphan handler is dead code that reads as coverage.
    const reachable = new Set(reachableHandlerNames(SYNC_DISPATCH).keys());
    expect(
      Object.keys(handlers).filter((name) => !reachable.has(name)),
    ).toEqual([]);
  });

  it('reaches the ingest tree, not just the orchestrator', () => {
    // A guard on the guard: if the walk stopped following the ingest imports,
    // both assertions above would pass vacuously.
    expect([...reachableHandlerNames(SYNC_DISPATCH).keys()]).toEqual(
      expect.arrayContaining([
        'conversations/internal_mutations:createConversationWithMessage',
        'contacts/internal_mutations:findOrCreateContact',
        'file_metadata/internal_mutations:bindFileToConversation',
        'connectors/execute_action:runConnectorAction',
      ]),
    );
  });
});
/**
 * A `sql` stand-in that records every statement it is handed. Each call
 * answers the rows `answer` returns for its text (an empty row set by
 * default), and the promise carries the statement's text and parameters, so
 * a nested fragment (`sql\`…\`` used as a parameter) stays inspectable from
 * the outer statement's values. `begin` runs the callback on the same tag.
 */
function recordingSql(answer: (text: string) => unknown[] = () => []) {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = {
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    };
    statements.push(statement);
    return Object.assign(Promise.resolve(answer(statement.text)), statement);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: (cb: (tx: unknown) => unknown) => Promise.resolve(cb(sql)),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as import('postgres').Sql, statements };
}

const NO_CONNECTOR = () => {
  throw new Error('no connector calls in this test');
};
const UNIQUE_VIOLATION = () =>
  Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
  });
const LANDED = { id: 'm-first', conversationId: 'c-first' };
const INITIAL_MESSAGE = {
  sender: 'carla@ext.test',
  content: 'hello',
  isCustomer: true,
  externalMessageId: 'mid-1@ext.test',
};

/**
 * Two passes of one mailbox can overlap and both insert the same Message-ID;
 * the partial unique index (0077) refuses the second write. The shim lands
 * the loser on the winner's row so the ingest treats the mail as already
 * landed — never a failed pass, never the mail twice.
 */
describe('ingest writers — the loser of a Message-ID race', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createConversationWithMessage answers the row the Message-ID already landed on', async () => {
    createConversation.mockRejectedValueOnce(UNIQUE_VIOLATION());
    const { sql, statements } = recordingSql((text) =>
      text.includes('FROM app.conversation_messages') ? [LANDED] : [],
    );
    const handler = conversationShimHandlers(sql, NO_CONNECTOR)[
      'conversations/internal_mutations:createConversationWithMessage'
    ];
    if (!handler) throw new Error('handler missing');
    await expect(
      handler({
        organizationId: 'o1',
        externalMessageId: 'mid-1@ext.test',
        initialMessage: INITIAL_MESSAGE,
      }),
    ).resolves.toEqual({ conversationId: 'c-first', messageId: 'm-first' });
    const lookup = statements.find((s) =>
      s.text.includes('FROM app.conversation_messages'),
    );
    expect(lookup?.text).toContain('org_id = ?');
    expect(lookup?.values).toEqual(['o1', 'mid-1@ext.test']);
  });

  it('addMessageToConversation answers the conversation the Message-ID already landed on', async () => {
    addMessageToConversation.mockRejectedValueOnce(UNIQUE_VIOLATION());
    const { sql } = recordingSql((text) =>
      text.includes('FROM app.conversation_messages') ? [LANDED] : [],
    );
    const handler = conversationShimHandlers(sql, NO_CONNECTOR)[
      'conversations/internal_mutations:addMessageToConversation'
    ];
    if (!handler) throw new Error('handler missing');
    await expect(
      handler({
        organizationId: 'o1',
        conversationId: 'c-target',
        ...INITIAL_MESSAGE,
      }),
    ).resolves.toBe('c-first');
  });

  it('rethrows every other error, and a violation whose winner is not found', async () => {
    createConversation.mockRejectedValueOnce(new Error('connection reset'));
    const { sql } = recordingSql();
    const handler = conversationShimHandlers(sql, NO_CONNECTOR)[
      'conversations/internal_mutations:createConversationWithMessage'
    ];
    if (!handler) throw new Error('handler missing');
    const args = {
      organizationId: 'o1',
      externalMessageId: 'mid-1@ext.test',
      initialMessage: INITIAL_MESSAGE,
    };
    await expect(handler(args)).rejects.toThrow('connection reset');
    createConversation.mockRejectedValueOnce(UNIQUE_VIOLATION());
    await expect(handler(args)).rejects.toThrow('duplicate key');
  });
});

describe('findOrCreateContact shim', () => {
  it('delegates to the contacts domain inside one transaction, source vocabulary enforced', async () => {
    const { sql } = recordingSql();
    const handler = conversationShimHandlers(sql, NO_CONNECTOR)[
      'contacts/internal_mutations:findOrCreateContact'
    ];
    if (!handler) throw new Error('handler missing');
    await expect(
      handler({
        organizationId: 'o1',
        email: ' Carla@Ext.Test ',
        name: 'Carla',
        source: 'conversation',
        metadata: { createdFrom: 'email_sync' },
      }),
    ).resolves.toEqual({ contactId: 'ct-1', created: true });
    // The shim used to carry its own SELECT+INSERT (blind to trashed rows,
    // no audit row); the contacts service owns the lock, lookup and record.
    expect(findOrCreateContactByEmail).toHaveBeenCalledTimes(1);
    expect(findOrCreateContactByEmail).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        organizationId: 'o1',
        email: ' Carla@Ext.Test ',
        name: 'Carla',
        source: 'conversation',
        metadata: { createdFrom: 'email_sync' },
      }),
    );
    await expect(
      handler({ organizationId: 'o1', email: 'x@ext.test', source: 'email' }),
    ).rejects.toThrow();
  });
});

describe('updateConversationMessage shim', () => {
  it('merges the re-synced envelope onto the stored metadata instead of replacing it', async () => {
    const { sql, statements } = recordingSql();
    const handler = conversationShimHandlers(sql, () => {
      throw new Error('no connector calls in this test');
    })['conversations/internal_mutations:updateConversationMessage'];
    if (!handler) throw new Error('handler missing');
    const envelope = { from: [{ address: 'carla@ext.test' }], to: [] };
    await handler({
      messageId: 'm1',
      deliveryState: 'delivered',
      deliveredAt: 1_000,
      metadata: envelope,
    });
    const update = statements.find((s) => s.text.startsWith('UPDATE'));
    if (!update) throw new Error('no UPDATE issued');
    // The metadata column is set from a fragment, not a bare parameter…
    const fragment = update.values.find(
      (value): value is { text: string; values: unknown[] } =>
        typeof value === 'object' &&
        value !== null &&
        'text' in value &&
        typeof value.text === 'string' &&
        value.text.includes('coalesce(metadata'),
    );
    expect(fragment).toBeDefined();
    // …and the fragment is the `||` merge carrying exactly the envelope, so
    // insert-time `sender` / `isCustomer` survive the re-sync.
    expect(fragment?.text).toBe("coalesce(metadata, '{}'::jsonb) || ?");
    expect(fragment?.values).toEqual([envelope]);
  });

  it('leaves metadata untouched when the update names none', async () => {
    const { sql, statements } = recordingSql();
    const handler = conversationShimHandlers(sql, () => {
      throw new Error('no connector calls in this test');
    })['conversations/internal_mutations:updateConversationMessage'];
    if (!handler) throw new Error('handler missing');
    await handler({ messageId: 'm1', deliveryState: 'sent' });
    const update = statements.find((s) => s.text.startsWith('UPDATE'));
    expect(update?.values).toContain('metadata');
  });
});

/**
 * Binding is what starts indexing. Materialize registers every emailed
 * attachment `skip_rag_indexing = true` (no conversation to scope the corpus
 * row to yet), and every knowledge enqueue gate refuses a skip row — so
 * before this lane `bindEmailAttachments` counted `queued` forever at 0 and
 * the conversation-scope retrievability branch had no producer.
 */
describe('bindFileToConversation shim', () => {
  beforeEach(() => vi.clearAllMocks());

  const FILE: {
    id: string;
    organizationId: string;
    conversationId: string | null;
    documentId: string | null;
    ragStatus: string | null;
    mailReceivedAt: number | null;
    createdAt: number;
  } = {
    id: 'f1',
    organizationId: 'o1',
    conversationId: null,
    documentId: null,
    ragStatus: null,
    mailReceivedAt: null,
    createdAt: 1_000,
  };
  const bind = (row: Partial<typeof FILE>) => {
    const recorded = recordingSql((text) =>
      text.includes('FROM app.file_metadata') ? [{ ...FILE, ...row }] : [],
    );
    const handler = conversationShimHandlers(recorded.sql, NO_CONNECTOR)[
      'file_metadata/internal_mutations:bindFileToConversation'
    ];
    if (!handler) throw new Error('handler missing');
    return { ...recorded, handler };
  };
  const ARGS = {
    organizationId: 'o1',
    storageId: 's3://mail/brief.pdf',
    conversationId: 'c1',
    receivedAt: 500,
  };

  it('un-skips, marks queued and dispatches a fresh bind in the binding transaction', async () => {
    const { handler, statements } = bind({});
    await expect(handler(ARGS)).resolves.toBe('bound_and_queued');
    const update = statements.find((s) => s.text.startsWith('UPDATE'));
    expect(update?.text).toContain('skip_rag_indexing = ?');
    // conversation_id, mail_received_at_ms, skip_rag_indexing, id
    expect(update?.values).toEqual(['c1', 500, false, 'f1']);
    expect(markRagQueued).toHaveBeenCalledWith(expect.anything(), 'f1');
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'rag.index_file',
      { fileId: 'f1' },
    );
    expect(markRagQueued.mock.invocationCallOrder[0]).toBeLessThan(
      addJobInTx.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('queues an already-bound row that was never indexed (bound before this lane)', async () => {
    const { handler, statements } = bind({
      conversationId: 'c1',
      mailReceivedAt: 500,
    });
    await expect(handler(ARGS)).resolves.toBe('queued');
    const update = statements.find((s) => s.text.startsWith('UPDATE'));
    // The link and the stamp are kept as they are; only the skip flips.
    expect(update?.values).toEqual([
      'conversation_id',
      'mail_received_at_ms',
      false,
      'f1',
    ]);
    expect(addJobInTx).toHaveBeenCalledTimes(1);
  });

  it('leaves a bound row alone once it has been queued — a re-poll is a no-op', async () => {
    const { handler, statements } = bind({
      conversationId: 'c1',
      mailReceivedAt: 500,
      ragStatus: 'queued',
    });
    await expect(handler(ARGS)).resolves.toBe('unchanged');
    expect(statements.some((s) => s.text.startsWith('UPDATE'))).toBe(false);
    expect(markRagQueued).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it("binds a document's file without queueing it — the document owns its indexing", async () => {
    const { handler, statements } = bind({ documentId: 'd1' });
    await expect(handler(ARGS)).resolves.toBe('bound');
    const update = statements.find((s) => s.text.startsWith('UPDATE'));
    expect(update?.values).toEqual(['c1', 500, 'skip_rag_indexing', 'f1']);
    expect(markRagQueued).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('refuses a row of another organization before touching it', async () => {
    const { handler, statements } = bind({ organizationId: 'o2' });
    await expect(handler(ARGS)).resolves.toBe('other_org');
    expect(statements.some((s) => s.text.startsWith('UPDATE'))).toBe(false);
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});

const patch = () => {
  const handler = conversationShimHandlers(SQL, () => {
    throw new Error('no connector calls in this test');
  })['connector_credentials/mutations:patchCredentialInternal'];
  if (!handler) throw new Error('handler missing');
  return handler;
};

describe('resolveCredentialRefInternal shim', () => {
  beforeEach(() => vi.clearAllMocks());

  it('serves the shared full-row answer the reused resolver decrypts (not an identity-only stub)', async () => {
    const row = {
      _id: 'cred_1',
      organizationId: 'o1',
      connectorSlug: 'imap-smtp',
      authMethod: 'basic',
      name: 'Support inbox',
      encryptedData: { keyFingerprint: 'fp' },
      config: { host: 'imap.door.test' },
      status: 'active',
    };
    resolveCredentialRowForShim.mockResolvedValueOnce(row as never);
    const handler = conversationShimHandlers(SQL, () => {
      throw new Error('no connector calls in this test');
    })['connector_credentials/queries:resolveCredentialRefInternal'];
    if (!handler) throw new Error('handler missing');
    const answer = await handler({
      organizationId: 'o1',
      connectorSlug: 'imap-smtp',
      credentialRef: 'cred_1',
    });
    expect(resolveCredentialRowForShim).toHaveBeenCalledWith(SQL, {
      organizationId: 'o1',
      connectorSlug: 'imap-smtp',
      credentialRef: 'cred_1',
    });
    expect(answer).toBe(row);
  });
});

describe('patchCredentialInternal shim', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists a config heal (the IMAP fromAddress mirror)', async () => {
    const config = { host: 'imap.door.test', fromAddress: 'inbox@door.test' };
    await patch()({ organizationId: 'o1', credentialId: 'cred_1', config });
    expect(patchCredentialConfigInternal).toHaveBeenCalledWith(
      SQL,
      'o1',
      'cred_1',
      config,
    );
    // A pure config heal names no watermark, so none is written.
    expect(patchMailSyncWatermarks).not.toHaveBeenCalled();
  });

  it('advances the watermarks it is handed, touching no config', async () => {
    await patch()({
      organizationId: 'o1',
      credentialId: 'cred_1',
      mailSyncInboundSince: 1_000,
    });
    expect(patchMailSyncWatermarks).toHaveBeenCalledWith(SQL, 'o1', 'cred_1', {
      inboundSince: 1_000,
    });
    expect(patchCredentialConfigInternal).not.toHaveBeenCalled();
  });

  it('lands both when a call names both', async () => {
    await patch()({
      organizationId: 'o1',
      credentialId: 'cred_1',
      mailSyncOutboundSince: 2_000,
      config: { fromAddress: 'inbox@door.test' },
    });
    expect(patchCredentialConfigInternal).toHaveBeenCalledTimes(1);
    expect(patchMailSyncWatermarks).toHaveBeenCalledWith(SQL, 'o1', 'cred_1', {
      outboundSince: 2_000,
    });
  });

  it('refuses a config carrying non-scalar values', async () => {
    await expect(
      patch()({
        organizationId: 'o1',
        credentialId: 'cred_1',
        config: { nested: { not: 'allowed' } },
      }),
    ).rejects.toThrow();
    expect(patchCredentialConfigInternal).not.toHaveBeenCalled();
  });
});
