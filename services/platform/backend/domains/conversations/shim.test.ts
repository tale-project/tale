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
} = vi.hoisted(() => ({
  patchMailSyncWatermarks: vi.fn(async () => undefined),
  patchCredentialConfigInternal: vi.fn(async () => undefined),
  resolveCredentialRowForShim: vi.fn(async () => null),
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
 * answers an empty row set, and the promise carries the statement's text and
 * parameters, so a nested fragment (`sql\`…\`` used as a parameter) stays
 * inspectable from the outer statement's values.
 */
function recordingSql() {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = {
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    };
    statements.push(statement);
    return Object.assign(Promise.resolve([] as unknown[]), statement);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as import('postgres').Sql, statements };
}

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
