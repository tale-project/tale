import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setCodeRunner } from '../../engine/core/runner';
import { nodeVmRunner } from '../../engine/runners/node-vm';
import {
  executeConnectorAction,
  loadConnectorCatalog,
  nativeImplIds,
  type CredentialResolver,
} from '../dispatcher';
import {
  NATIVE_IMPL_IDS,
  registerNativeConnectors,
  type MailTransport,
  type SandboxScriptRunner,
  type WebdavStore,
  type WorkflowConversationStore,
  type WorkflowDocumentStore,
  type WorkflowTaskStore,
} from './index';

/**
 * The wiring test: with the natives registered, every one of the six shipped
 * native actions dispatches for real and comes back in the shape its connector
 * declares — so the dispatcher's "this backend is not available in this
 * deployment" refusal can no longer fire for any of them.
 *
 * The shape is compared against the connector's own deterministic mock rather
 * than a copy of it written here: the mock IS the declared output, so a live
 * body that drifts from it fails this test instead of surprising a caller.
 *
 * Nothing here reaches a network, a mail server, or a database — the document
 * store and the mail transport are doubles.
 */

const SYSTEM_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../configs/platform/system',
);

const ORG = 'org_wiring';

/** The six actions, with an input that satisfies each declared schema. */
const NATIVE_ACTIONS: Array<{
  impl: string;
  connector: string;
  action: string;
  input: Record<string, unknown>;
}> = [
  {
    impl: 'imap-smtp.list_messages',
    connector: 'imap-smtp',
    action: 'list_messages',
    input: { mailbox: 'INBOX', limit: 25 },
  },
  {
    impl: 'imap-smtp.get_message',
    connector: 'imap-smtp',
    action: 'get_message',
    input: { uid: '42', mailbox: 'INBOX' },
  },
  {
    impl: 'imap-smtp.send',
    connector: 'imap-smtp',
    action: 'send',
    input: { to: 'person@example.com', subject: 'Hello', text: 'Hi there.' },
  },
  {
    impl: 'webdav.list',
    connector: 'webdav',
    action: 'list',
    input: { path: '/reports' },
  },
  {
    impl: 'webdav.read',
    connector: 'webdav',
    action: 'read',
    input: { path: '/reports/q3.md' },
  },
  {
    impl: 'webdav.write',
    connector: 'webdav',
    action: 'write',
    input: { path: '/reports/summary.md', content: '# Summary' },
  },
  {
    impl: 'webdav.delete',
    connector: 'webdav',
    action: 'delete',
    input: { path: '/reports/old.md' },
  },
  {
    impl: 'sandbox.run_script',
    connector: 'sandbox',
    action: 'run_script',
    input: { skill: 'document-verify', entry: 'scripts/run_batch.py' },
  },
  {
    impl: 'task.get',
    connector: 'task',
    action: 'get',
    input: { taskId: 'tsk_1' },
  },
  {
    impl: 'task.update_status',
    connector: 'task',
    action: 'update_status',
    input: { taskId: 'tsk_1', status: 'in_progress' },
  },
  {
    impl: 'task.comment',
    connector: 'task',
    action: 'comment',
    input: { taskId: 'tsk_1', body: 'Prepared the return.' },
  },
  {
    impl: 'task.list_comments',
    connector: 'task',
    action: 'list_comments',
    input: { taskId: 'tsk_1', authorTypes: ['user'], limit: 20 },
  },
  {
    impl: 'document.list',
    connector: 'document',
    action: 'list',
    input: { folderId: 'fld_1' },
  },
  {
    impl: 'document.create',
    connector: 'document',
    action: 'create',
    input: {
      folderId: 'fld_1',
      name: 'return.xml',
      storageId: 'blob_1',
      contentType: 'application/xml',
    },
  },
  {
    impl: 'conversation.sync_mailbox',
    connector: 'conversation',
    action: 'sync_mailbox',
    input: { connectorSlug: 'imap-smtp', limit: 25 },
  },
  {
    impl: 'conversation.list_mailbox_messages',
    connector: 'conversation',
    action: 'list_mailbox_messages',
    input: { connectorSlug: 'imap-smtp', limit: 25 },
  },
  {
    impl: 'conversation.ingest_emails',
    connector: 'conversation',
    action: 'ingest_emails',
    input: {
      connectorSlug: 'gmail',
      emails: [
        {
          messageId: 'msg-1',
          from: [{ address: 'a@b.com' }],
          to: [{ address: 'you@example.com' }],
          subject: 'Hi',
          date: '2026-01-01T00:00:00Z',
        },
      ],
    },
  },
  {
    impl: 'conversation.ingest_sent_emails',
    connector: 'conversation',
    action: 'ingest_sent_emails',
    input: {
      connectorSlug: 'imap-smtp',
      emails: [
        {
          messageId: 'msg-2',
          from: [{ address: 'you@example.com' }],
          to: [{ address: 'a@b.com' }],
          subject: 'Re: Hi',
          date: '2026-01-01T00:00:00Z',
          direction: 'outbound',
        },
      ],
    },
  },
  {
    impl: 'conversation.query_sync_cursor',
    connector: 'conversation',
    action: 'query_sync_cursor',
    input: { connectorSlug: 'gmail', direction: 'inbound' },
  },
];

/** The store double: enough shape for the actions, no Convex. */
const store: WebdavStore = {
  list: () =>
    Promise.resolve([
      { name: 'archive', isDir: true, size: 0 },
      { name: 'notes.md', isDir: false, size: 128 },
    ]),
  read: () =>
    Promise.resolve({
      bytes: new TextEncoder().encode('# Q3'),
      contentType: 'text/markdown',
    }),
  write: () => Promise.resolve(),
  remove: () => Promise.resolve(true),
};

/** The mail double: no sockets, no mail libraries loaded. */
const transport: MailTransport = {
  openImap: () =>
    Promise.resolve({
      listMessages: () =>
        Promise.resolve([
          {
            uid: '17',
            from: 'sender@example.com',
            subject: 'Quarterly numbers',
            sentAt: 1_700_000_000_000,
          },
        ]),
      getMessage: (uid) =>
        Promise.resolve({
          uid,
          messageId: `<mock-${uid}@example.com>`,
          from: [{ address: 'sender@example.com' }],
          to: [{ address: 'you@example.com' }],
          cc: [],
          subject: 'Mock subject',
          date: '1970-01-01T00:00:00.000Z',
          text: 'Mock body',
          flags: [],
          headers: {
            'message-id': `<mock-${uid}@example.com>`,
            'in-reply-to': '<parent@example.com>',
            references: '<parent@example.com>',
          },
        }),
      close: () => Promise.resolve(),
    }),
  openSmtp: () =>
    Promise.resolve({
      send: () => Promise.resolve({ messageId: '<sent-1@example.com>' }),
      close: () => Promise.resolve(),
    }),
};

/** The script-runner double: the declared shape, no sandbox. Mirrors the
 * connector mock's result keys so the live-vs-mock shape comparison holds. */
const scriptRunner: SandboxScriptRunner = ({ skill, entry }) =>
  Promise.resolve({
    ok: true,
    status: 'completed',
    result: {
      status: 'ok',
      verdict: { passed: true, issues: [] },
      period: { label: 'LIVE-PERIOD' },
      report: { n_transactions: 2 },
      history: { warnings: [] },
    },
    files: [
      {
        name: 'return.xml',
        storageId: 'blob_live_return',
        size: 512,
        contentType: 'application/xml',
      },
    ],
    exitCode: 0,
    stdoutPreview: `ran ${skill}/${entry}`,
    stderrPreview: '',
    durationMs: 5,
  });

/** Task and document store doubles — the declared shapes, no Convex. */
const taskStore: WorkflowTaskStore = {
  get: ({ taskId }) =>
    Promise.resolve({
      taskId,
      title: 'Document batch — 2026Q1',
      status: 'todo',
      projectId: 'proj_double',
      externalSystem: 'acme',
      externalId: 'fld_quarter',
      externalUrl: 'fld_setup',
    }),
  updateStatus: () => Promise.resolve({ ok: true }),
  comment: () => Promise.resolve({ messageId: 'msg_1' }),
  listComments: () =>
    Promise.resolve([
      {
        authorType: 'user' as const,
        authorId: 'usr_double',
        body: 'Please re-check page 3.',
        createdAt: 1_750_000_000_000,
      },
    ]),
};

const documentStore: WorkflowDocumentStore = {
  listFolder: () =>
    Promise.resolve({
      files: [{ name: 'invoice-001.pdf', storageId: 'blob_a' }],
      truncated: false,
    }),
  create: ({ name }) =>
    Promise.resolve({ documentId: `doc_${name.length}`, action: 'created' }),
};

const conversationStore: WorkflowConversationStore = {
  ingestEmails: () =>
    Promise.resolve({
      created: true,
      processedCount: 1,
      skippedCount: 0,
      conversationIds: ['conv_mock'],
    }),
  ingestSentEmails: () =>
    Promise.resolve({
      created: false,
      processedCount: 1,
      skippedCount: 0,
      conversationIds: ['conv_mock'],
    }),
  querySyncCursor: () => Promise.resolve({ since: null, messageId: null }),
  syncMailbox: () =>
    Promise.resolve({
      listed: 1,
      inbound: {
        created: true,
        processedCount: 1,
        skippedCount: 0,
        conversationIds: ['conv_mock'],
      },
    }),
  listMailboxMessages: () =>
    Promise.resolve({
      messages: [
        {
          id: 'mock-1',
          uid: 'mock-1',
          subject: 'Mock message 1',
          from: 'sender1@example.com',
          sentAt: 1000,
          credentialName: 'default',
        },
      ],
    }),
};

const credentials: CredentialResolver = {
  resolve: () =>
    Promise.resolve({
      credentialId: 'cred_1',
      authMethod: 'basic',
      secrets: { username: 'mailbox@example.com', password: 'hunter2' },
    }),
};

/**
 * A value's structure, ignoring the values themselves: `{a: 1}` and `{a: 2}`
 * have the same shape, `{a: 1}` and `{a: '1'}` do not. Arrays are described by
 * their first element, which is what an output signature says too.
 */
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.length === 0 ? ['empty'] : [shapeOf(value[0])];
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, shapeOf(entry)]),
    );
  }
  return typeof value;
}

let dispose: () => void;

beforeAll(() => {
  // The mock bodies are JavaScript; the sandbox seam has to be installed for
  // the shape comparison below to run them.
  setCodeRunner(nodeVmRunner());
  loadConnectorCatalog(SYSTEM_ROOT);
});

beforeEach(() => {
  dispose = registerNativeConnectors({
    webdav: store,
    sandboxScripts: scriptRunner,
    tasks: taskStore,
    documents: documentStore,
    conversations: conversationStore,
    mailTransport: transport,
    mailConfig: () => ({
      imap: {
        host: 'mail.example.com',
        port: 993,
        secure: true,
        user: 'mailbox@example.com',
        password: 'hunter2',
      },
      smtp: {
        host: 'mail.example.com',
        port: 587,
        secure: false,
        user: 'mailbox@example.com',
        password: 'hunter2',
      },
      from: 'mailbox@example.com',
      connectTimeoutMs: 1000,
      socketTimeoutMs: 2000,
    }),
  });
});

afterEach(() => {
  dispose();
});

describe('registration', () => {
  it('registers every native backend the shipped catalog declares', () => {
    expect(nativeImplIds()).toEqual(
      expect.arrayContaining([...NATIVE_IMPL_IDS]),
    );
  });

  it('leaves nothing behind when the registration is disposed', () => {
    dispose();
    expect(nativeImplIds()).toEqual([]);
    // Re-register so afterEach's dispose stays a no-op rather than a surprise.
    dispose = registerNativeConnectors({
      webdav: store,
      sandboxScripts: scriptRunner,
      tasks: taskStore,
      documents: documentStore,
      conversations: conversationStore,
      mailTransport: transport,
    });
  });
});

describe('dispatching the shipped native actions', () => {
  it.each(NATIVE_ACTIONS)(
    'runs $impl live and returns the declared shape',
    async ({ connector, action, input }) => {
      const live = await executeConnectorAction({
        connector,
        action,
        input,
        // The workflow caller gates approvals in the executor, so a write
        // action reaches its backend here without a second prompt.
        caller: { kind: 'workflow', runId: 'run_1', nodeId: 'node_1' },
        ctx: { organizationId: ORG, mode: 'live', credentials },
      });
      const mocked = await executeConnectorAction({
        connector,
        action,
        input,
        caller: { kind: 'workflow', runId: 'run_1', nodeId: 'node_1' },
        ctx: { organizationId: ORG },
      });

      expect(live).toMatchObject({ status: 'ok', backend: 'native' });
      expect(mocked).toMatchObject({ status: 'ok', backend: 'mock' });
      if (live.status !== 'ok' || mocked.status !== 'ok') return;
      expect(shapeOf(live.output)).toEqual(shapeOf(mocked.output));
    },
  );

  it('refuses loudly again once the natives are gone', async () => {
    dispose();
    await expect(
      executeConnectorAction({
        connector: 'webdav',
        action: 'read',
        input: { path: '/reports/q3.md' },
        caller: { kind: 'workflow', runId: 'run_1', nodeId: 'node_1' },
        ctx: { organizationId: ORG, mode: 'live', credentials },
      }),
    ).rejects.toMatchObject({ code: 'NATIVE_IMPL_UNAVAILABLE' });

    dispose = registerNativeConnectors({
      webdav: store,
      sandboxScripts: scriptRunner,
      tasks: taskStore,
      documents: documentStore,
      conversations: conversationStore,
      mailTransport: transport,
    });
  });

  describe('task.update_status offers only the statuses it can honour', () => {
    const move = (status: string) =>
      executeConnectorAction({
        connector: 'task',
        action: 'update_status',
        input: { taskId: 'tsk_1', status },
        caller: { kind: 'workflow', runId: 'run_1', nodeId: 'node_1' },
        ctx: { organizationId: ORG, mode: 'live', credentials },
      });

    it('refuses `done` on the CONTRACT, before any store is touched', async () => {
      // Completion belongs to the human review gate, so the catalog schema
      // does not list it: the refusal names the values that DO work, and it
      // lands at authoring/dispatch time instead of mid-run.
      await expect(move('done')).rejects.toMatchObject({
        code: 'INPUT_INVALID',
      });
      await expect(move('done')).rejects.toThrow(/in_review/);
    });

    it('lets an automation cancel — abandoning a card is not completing it', async () => {
      expect(await move('cancelled')).toMatchObject({
        status: 'ok',
        backend: 'native',
      });
    });

    it('renders a store refusal CODE as a sentence an operator can act on', async () => {
      const restore = registerNativeConnectors({
        webdav: store,
        sandboxScripts: scriptRunner,
        documents: documentStore,
        conversations: conversationStore,
        mailTransport: transport,
        tasks: {
          ...taskStore,
          updateStatus: () =>
            Promise.resolve({ ok: false, reason: 'TASK_HAS_OPEN_SUBTASKS' }),
        },
      });
      try {
        await expect(move('cancelled')).rejects.toThrow(/open subtasks/);
      } finally {
        restore();
      }
    });
  });
});
