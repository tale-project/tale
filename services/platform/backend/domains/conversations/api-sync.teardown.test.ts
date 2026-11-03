// @vitest-environment node

/**
 * A `deleted: true` snapshot closes the mirror and nothing else. The
 * reference promises "Closing preserves the conversation and messages in
 * the Inbox"; the reconcile loop used to run over the teardown's empty
 * message list and hard-delete every receipted message, so the Closed tab
 * read "No messages yet" one step after showing the transcript.
 */

import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

const { transactSerializable, emitHintInTx } = vi.hoisted(() => ({
  transactSerializable: vi.fn(),
  emitHintInTx: vi.fn(async () => undefined),
}));
vi.mock('@tale/shared/db/serializable', () => ({ transactSerializable }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));

import { apiSnapshotSchema, synchronizeConversation } from './api-sync.ts';
import type { IntegrationViewer } from './service.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** A transaction double answering the binding read with a live mirror at
 * version 2 (or that mirror as `binding` changes it) and recording every
 * statement the sync issues. */
function txDouble(
  binding: {
    ownerPrincipalKind?: string;
    ownerPrincipalId?: string;
    sourceDeleted?: boolean;
  } = {},
) {
  const statements: Statement[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.conversation_api_bindings')) {
      return Promise.resolve([
        {
          conversationId: 'conv-1',
          ownerPrincipalKind: 'user',
          ownerPrincipalId: 'user-1',
          externalContactId: 'crm:contact-1',
          version: '2',
          hash: 'h2',
          sourceDeleted: false,
          ...binding,
        },
      ]);
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js transaction tag
  return { tx: tx as unknown as TransactionSql, statements };
}

// The pre-transaction read (known attachment sizes) answers nothing.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
const sql = (() => Promise.resolve([])) as unknown as Sql;

const viewer: IntegrationViewer = {
  organizationId: 'org-1',
  userId: 'user-1',
  role: 'admin',
  sourceOwner: { kind: 'user', id: 'user-1' },
};

const teardown = apiSnapshotSchema.parse({
  source: 'crm',
  externalId: 'thread-1',
  externalContactId: 'crm:contact-1',
  version: 3,
  subject: 'Order 4711',
  status: 'closed',
  deleted: true,
  messages: [],
});

describe('a deleted snapshot', () => {
  it('closes the mirror and leaves every mirrored message in place [CONV-R15]', async () => {
    const { tx, statements } = txDouble();
    transactSerializable.mockImplementation(
      async (_sql: Sql, run: (tx: TransactionSql) => Promise<unknown>) =>
        run(tx),
    );

    await expect(
      synchronizeConversation(sql, viewer, teardown),
    ).resolves.toEqual({ conversationId: 'conv-1', applied: true });

    // No message row is read, written or deleted.
    expect(
      statements.some((s) => s.text.includes('app.conversation_messages')),
    ).toBe(false);
    expect(statements.some((s) => s.text.startsWith('DELETE'))).toBe(false);
    // The conversation is closed and the binding records the teardown.
    expect(
      statements.some((s) =>
        s.text.startsWith("UPDATE app.conversations SET status = 'closed'"),
      ),
    ).toBe(true);
    const binding = statements.find((s) =>
      s.text.startsWith(
        'UPDATE app.conversation_api_bindings SET snapshot_version',
      ),
    );
    expect(binding?.text).toContain('source_deleted = true');
    expect(binding?.values[0]).toBe(3);
    expect(emitHintInTx).toHaveBeenCalledTimes(1);
  });
});

/** The next content the source sends for the same conversation. */
const content = apiSnapshotSchema.parse({
  source: 'crm',
  externalId: 'thread-1',
  externalContactId: 'crm:contact-1',
  version: 3,
  subject: 'Order 4711',
  status: 'open',
  messages: [
    {
      externalId: 'm-9',
      content: 'One more thing.',
      isCustomer: true,
      authorName: 'Carla',
      createdAt: 1_789_230_000_000,
    },
  ],
});

/** Runs the sync on `tx` and answers what it refused with. */
function refusal(
  tx: TransactionSql,
  snapshot: typeof content,
  who: IntegrationViewer = viewer,
) {
  transactSerializable.mockImplementation(
    async (_sql: Sql, run: (tx: TransactionSql) => Promise<unknown>) => run(tx),
  );
  return synchronizeConversation(sql, who, snapshot).then(
    () => undefined,
    (error: unknown) => error,
  );
}

const wrote = (statements: Statement[]) =>
  statements.some((s) => /^(INSERT|UPDATE|DELETE)/.test(s.text));

describe('a mirror its source closed', () => {
  it('takes no more content and stays closed [CONV-R15]', async () => {
    const { tx, statements } = txDouble({ sourceDeleted: true });

    expect(await refusal(tx, content)).toMatchObject({
      name: 'ConversationError',
      code: 'CONVERSATION_CLOSED',
      status: 409,
    });
    // Nothing reopened it and no message landed.
    expect(wrote(statements)).toBe(false);
  });
});

describe('a mirror another integration created', () => {
  it.each([
    ['a content snapshot', content],
    ['a teardown', teardown],
  ])('refuses %s and changes nothing [CONV-R14]', async (_kind, snapshot) => {
    const { tx, statements } = txDouble({ ownerPrincipalId: 'user-2' });

    expect(await refusal(tx, snapshot)).toMatchObject({
      name: 'ConversationError',
      code: 'INTEGRATION_NOT_OWNED',
      status: 403,
    });
    expect(wrote(statements)).toBe(false);
  });

  it.each([
    ['a team', 'team', 'team-1'],
    ['the organization', 'organization', 'org-1'],
  ])(
    'refuses a person’s key for a mirror %s owns [CONV-R14]',
    async (_owner, ownerPrincipalKind, ownerPrincipalId) => {
      const { tx, statements } = txDouble({
        ownerPrincipalKind,
        ownerPrincipalId,
      });

      expect(await refusal(tx, content)).toMatchObject({
        code: 'INTEGRATION_NOT_OWNED',
      });
      expect(wrote(statements)).toBe(false);
    },
  );

  it('tells an owner by its kind as well as its id [CONV-R14]', async () => {
    // A team and the organization never share an owner, whatever their ids.
    const { tx, statements } = txDouble({
      ownerPrincipalKind: 'team',
      ownerPrincipalId: 'org-1',
    });
    const organization: IntegrationViewer = {
      ...viewer,
      userId: 'svc-org-1',
      sourceOwner: { kind: 'organization', id: 'org-1' },
    };

    expect(await refusal(tx, content, organization)).toMatchObject({
      code: 'INTEGRATION_NOT_OWNED',
    });
    expect(wrote(statements)).toBe(false);
  });
});

describe('a replacement key of the integration that created a mirror', () => {
  it('continues the mirror though its service identity is new [CONV-R14]', async () => {
    // The first key authenticated as `svc-org-1`; its replacement is a new
    // identity (`svc-org-2`) made for the same organization.
    const { tx, statements } = txDouble({
      ownerPrincipalKind: 'organization',
      ownerPrincipalId: 'org-1',
    });
    transactSerializable.mockImplementation(
      async (_sql: Sql, run: (tx: TransactionSql) => Promise<unknown>) =>
        run(tx),
    );
    const replacement: IntegrationViewer = {
      ...viewer,
      userId: 'svc-org-2',
      sourceOwner: { kind: 'organization', id: 'org-1' },
    };

    await expect(
      synchronizeConversation(sql, replacement, teardown),
    ).resolves.toEqual({ conversationId: 'conv-1', applied: true });
    expect(wrote(statements)).toBe(true);
  });

  it('reads the mirror’s attachments under the integration, not the key [CONV-R14]', async () => {
    const { tx, statements } = txDouble({
      ownerPrincipalKind: 'team',
      ownerPrincipalId: 'team-1',
    });
    const calls: Statement[] = [];
    // The pre-transaction read of known attachment sizes runs on `sql`.
    const reading = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({
          text: strings.join('?').replace(/\s+/g, ' ').trim(),
          values,
        });
        return Promise.resolve([]);
      },
      { unsafe: (text: string) => text },
    );
    transactSerializable.mockImplementation(
      async (_sql: Sql, run: (tx: TransactionSql) => Promise<unknown>) =>
        run(tx),
    );
    const replacement: IntegrationViewer = {
      ...viewer,
      userId: 'svc-team-2',
      sourceOwner: { kind: 'team', id: 'team-1' },
    };

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    await synchronizeConversation(
      reading as unknown as Sql,
      replacement,
      teardown,
    );

    const predicate = calls.find((call) =>
      call.text.includes('b.owner_principal_kind ='),
    );
    expect(predicate?.values).toEqual(['team', 'team-1']);
    expect(wrote(statements)).toBe(true);
  });
});
