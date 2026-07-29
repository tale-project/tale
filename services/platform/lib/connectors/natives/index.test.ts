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
    input: { skill: 'swiss-vat-return', entry: 'scripts/run_quarter.py' },
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
      title: 'VAT return — 2026Q1',
      status: 'todo',
      projectId: 'proj_double',
      externalSystem: 'vatplus',
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
        body: 'Please re-check box 400.',
        createdAt: 1_750_000_000_000,
      },
    ]),
};

const documentStore: WorkflowDocumentStore = {
  listFolder: () =>
    Promise.resolve([{ name: 'invoice-001.pdf', storageId: 'blob_a' }]),
  create: ({ name }) =>
    Promise.resolve({ documentId: `doc_${name.length}`, action: 'created' }),
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
    mailTransport: transport,
    mailConfig: () => ({
      imap: { host: 'mail.example.com', port: 993, secure: true },
      smtp: { host: 'mail.example.com', port: 587, secure: false },
      user: 'mailbox@example.com',
      password: 'hunter2',
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
      mailTransport: transport,
    });
  });
});
