import type { Sql } from 'postgres';

import { loadConnectorDefinitions } from '../../../lib/connectors/catalog.ts';
import {
  executeConnectorAction,
  installConnectorCatalog,
  type ApprovalGate,
  type ConnectorAuditSink,
  type ConnectorCaller,
  type ConnectorDispatchResult,
  type CredentialResolver,
} from '../../../lib/connectors/dispatcher.ts';
import { ConnectorError } from '../../../lib/connectors/errors.ts';
import {
  registerNativeConnectors,
  type MailTransport,
  type SandboxScriptRunner,
  type WorkflowConversationStore,
  type WorkflowDocumentStore,
  type WorkflowFolderFile,
} from '../../../lib/connectors/natives/index.ts';
import type { PortableHostCall } from '../../../lib/connectors/portable-live.ts';
import { registerConnector } from '../../../lib/connectors/registry.ts';
import {
  hasCodeRunner,
  setCodeRunner,
  type CodeRunner,
} from '../../../lib/engine/core/runner.ts';
import { nodeVmRunner } from '../../../lib/engine/runners/node-vm.ts';
import { signHostcallToken } from '../../core/connectors/hostcall_token.ts';
import {
  ingestEmails,
  ingestSentEmails,
  listMailboxMessages,
  querySyncCursor,
  syncMailbox,
} from '../../core/conversations/sync_mailbox.ts';
import { codeRunnerForSession } from '../../core/node_only/sandbox/engine_exec_runner.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { evaluateApprovalGate } from '../approvals/gate.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { resolveConnectorCredential } from '../connector_credentials/service.ts';
import { conversationShimHandlers } from '../conversations/shim.ts';
import {
  createHubDocument,
  listFolderDocumentsBounded,
} from '../documents/service.ts';
import { getOrgBlobBytes } from '../files/service.ts';
import { findHubFolderByPath } from '../folders/paths.ts';
import {
  FolderError,
  listFolders,
  loadFolderOrThrow,
  MAX_FOLDER_DEPTH,
} from '../folders/service.ts';
import { getProjectAuthContext } from '../projects/service.ts';
import { pgWebdavStore } from '../webdav/connector-store.ts';
import { collectWorkflowFolderFiles } from './document-listing.ts';
import { pgTaskStore } from './task-store.ts';

/**
 * The 0.5 door to the connector dispatcher — the twin of
 * `convex/connectors/execute_action.ts`: assembles the REUSED engine seams
 * (catalog + registry, the node-vm code runner, the native backends) and
 * supplies the PG credential resolver, the approvals gate, and the audit
 * sink, so the mailbox sync, automation connector nodes, and chat tools all
 * invoke connectors the same way.
 *
 * INTERNAL by contract — callers do their own authorization first.
 *
 * The sandbox script runner (`sandbox.run_script`) runs in the automation
 * run's own workflow session over the automations ctx shim — the same
 * session the run's agent nodes use. Live yaml-js bodies run on the
 * data-only in-process runner, which refuses host capabilities by design —
 * the out-of-process sandbox runner rides the external-turn bridge
 * increment.
 */

let mailTransportOverride: MailTransport | undefined;

/** Integration seam: inject a fake IMAP/SMTP transport. Pass undefined to
 * restore the real clients. */
export function setMailTransportForTesting(
  transport: MailTransport | undefined,
): void {
  mailTransportOverride = transport;
}

/**
 * The `sandbox.run_script` runner over the automations ctx shim — the run's
 * workflow session, skill staging and output harvest are the agent host's
 * seams, answered by the same handler map the stepper runs on. The shim
 * module is loaded lazily: it imports this door for the stepper's connector
 * nodes, and a static import back would close a cycle.
 */
function workflowScripts(sql: Sql): SandboxScriptRunner {
  return async (run) => {
    const [
      { automationShimHandlers, automationShimScheduler },
      { workflowScriptRunner },
    ] = await Promise.all([
      import('../automations/shim.ts'),
      import('../../core/automations/script_host.ts'),
    ]);
    const ctx = createCtxShim(automationShimHandlers(sql), {
      scheduler: automationShimScheduler(sql),
    });
    return workflowScriptRunner(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 host; every ctx facility it touches is covered by automationShimHandlers
      ctx as unknown as Parameters<typeof workflowScriptRunner>[0],
    )(run);
  };
}

/** The most files one `document.list` answers; past it the listing says
 * `truncated` so the agent narrows the folder instead of trusting a cut. */
const WORKFLOW_FOLDER_LIST_CAP = 200;

const systemAuthFor = async (sql: Sql, organizationId: string) =>
  getProjectAuthContext(sql, {
    organizationId,
    userId: 'system',
    role: 'owner',
  });

/**
 * The bounded hub-folder walk behind the workflow `document.list` native AND
 * the agent/script hosts' `files` mounts — one implementation of "which files
 * does this folder hold for a run". The folder is named by id or by human
 * path ("Clients/Acme" — the same walk the sync engines resolve with); null
 * = it does not exist in this org's hub tree.
 */
export async function listWorkflowFolderFiles(
  sql: Sql,
  {
    organizationId,
    folderId,
    folderPath,
    recursive,
  }: {
    organizationId: string;
    folderId?: string;
    folderPath?: string;
    recursive?: boolean;
  },
): Promise<{
  files: Array<WorkflowFolderFile & { blobRef: string | null }>;
  truncated: boolean;
} | null> {
  let rootFolderId: string;
  if (folderId !== undefined) {
    const folder = await loadFolderOrThrow(sql, folderId).catch(
      (error: unknown) => {
        if (error instanceof FolderError) return null;
        throw error;
      },
    );
    if (
      folder === null ||
      folder.organizationId !== organizationId ||
      folder.projectId !== null
    ) {
      return null;
    }
    rootFolderId = folder.id;
  } else if (folderPath !== undefined) {
    const resolved = await findHubFolderByPath(
      sql,
      organizationId,
      folderPath.split('/'),
    );
    if (resolved === null) return null;
    rootFolderId = resolved;
  } else {
    return null;
  }
  const auth = await systemAuthFor(sql, organizationId);
  const walked = await collectWorkflowFolderFiles(
    {
      filesIn: async (id, limit) => {
        const page = await listFolderDocumentsBounded(sql, auth, {
          folderId: id,
          limit,
        });
        return {
          files: page.documents.map((doc) => ({
            name: doc.title ?? doc.id,
            storageId: doc.fileRef ?? doc.id,
            blobRef: doc.fileRef ?? null,
          })),
          truncated: page.truncated,
        };
      },
      subfoldersOf: async (id) =>
        (await listFolders(sql, auth, { parentId: id })).map((folder) => ({
          id: folder.id,
          name: folder.name,
        })),
    },
    {
      rootFolderId,
      recursive: recursive ?? false,
      cap: WORKFLOW_FOLDER_LIST_CAP,
      maxDepth: MAX_FOLDER_DEPTH,
    },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the walk preserves the file shape it was fed, blobRef included
  return walked as {
    files: Array<WorkflowFolderFile & { blobRef: string | null }>;
    truncated: boolean;
  };
}

/** The document natives over the 0.5 documents domain. */
function pgDocumentStore(sql: Sql): WorkflowDocumentStore {
  return {
    async listFolder(args) {
      const listing = await listWorkflowFolderFiles(sql, args);
      if (listing === null) return null;
      return {
        files: listing.files.map(({ name, storageId }) => ({
          name,
          storageId,
        })),
        truncated: listing.truncated,
      };
    },
    async create({ organizationId, folderId, name, content, contentType }) {
      const auth = await systemAuthFor(sql, organizationId);
      const documentId = await sql.begin((tx) =>
        createHubDocument(tx, auth, {
          title: name,
          ...(content !== undefined ? { content } : {}),
          ...(contentType !== undefined ? { mimeType: contentType } : {}),
          folderId,
          sourceProvider: 'workflow',
        }),
      );
      return { documentId, action: 'created' };
    },
  };
}

/** The conversation natives — the REUSED 0.4 sync/ingest modules whole, on
 * the conversations shim (which recurses back into this door for the mail
 * fetches). */
function pgConversationStore(sql: Sql): WorkflowConversationStore {
  const shim = () => {
    const handlers = conversationShimHandlers(sql, (args) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the recursion passes the sync module's own caller shape through
      runConnectorAction(sql, args as RunConnectorArgs),
    );
    const ctx = createCtxShim(handlers);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 modules; every ctx facility they touch is covered by the shim handlers
    return ctx as unknown as Parameters<typeof syncMailbox>[0];
  };
  return {
    // The native returns the ingest result; the ingestedTip rides alongside it
    // for the sync watermark only, so the workflow-facing binding drops it.
    ingestEmails: (args) => ingestEmails(shim(), args).then((o) => o.result),
    ingestSentEmails: (args) =>
      ingestSentEmails(shim(), args).then((o) => o.result),
    querySyncCursor: (args) => querySyncCursor(shim(), args),
    syncMailbox: (args) => syncMailbox(shim(), args),
    listMailboxMessages: (args) => listMailboxMessages(shim(), args),
  };
}

function credentialResolver(sql: Sql): CredentialResolver {
  return {
    resolve: (organizationId, connectorSlug, credentialRef) =>
      resolveConnectorCredential(sql, {
        organizationId,
        connectorSlug,
        ...(credentialRef !== undefined ? { credentialRef } : {}),
      }),
  };
}

function approvalGate(sql: Sql): ApprovalGate {
  return {
    check: async (request) => {
      const decision = await evaluateApprovalGate(sql, {
        organizationId: request.organizationId,
        source: 'connector',
        resourceKey: request.idempotencyKey,
        connector: request.connector,
        action: request.action,
        effect: 'write',
        platformInternal: request.platformInternal,
        ...(request.userId !== '' ? { requestedBy: request.userId } : {}),
        input: request.input,
      });
      if (decision.decision === 'allow') {
        return { status: 'allowed' };
      }
      if (decision.decision === 'needs-approval') {
        return { status: 'required', approvalId: decision.approvalId };
      }
      throw new ConnectorError(
        'APPROVAL_REJECTED',
        'This operation was rejected and will not run. Ask again with a new request if it should proceed.',
      );
    },
  };
}

function auditSink(sql: Sql): ConnectorAuditSink {
  return {
    record: async (entry) => {
      await sql.begin((tx) =>
        createAuditLog(tx, {
          organizationId: entry.organizationId,
          actorId: entry.callerKind === 'system' ? 'system' : entry.callerRef,
          actorType: entry.callerKind,
          action: `connector.${entry.nodeType}`,
          category: 'connector',
          resourceType: 'connector',
          resourceId: entry.nodeType,
          resourceName: entry.connector,
          status:
            entry.outcome === 'ok'
              ? 'success'
              : entry.outcome === 'error'
                ? 'failure'
                : 'denied',
          ...(entry.error !== undefined ? { errorMessage: entry.error } : {}),
          metadata: {
            mode: entry.mode,
            effects: entry.effects,
            caller: entry.callerRef,
            idempotencyKey: entry.idempotencyKey,
            ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
            ...(entry.credentialId !== undefined
              ? { credentialId: entry.credentialId }
              : {}),
          },
        }),
      );
    },
  };
}

/** Install the seams one invocation needs — cheap and idempotent (the
 * catalog read is stat-memoized). */
function assembleConnectorHost(sql: Sql): void {
  if (!hasCodeRunner()) setCodeRunner(nodeVmRunner());
  const connectors = loadConnectorDefinitions();
  installConnectorCatalog(connectors);
  for (const connector of connectors) registerConnector(connector);
  registerNativeConnectors({
    webdav: pgWebdavStore(sql),
    sandboxScripts: workflowScripts(sql),
    tasks: pgTaskStore(sql),
    documents: pgDocumentStore(sql),
    conversations: pgConversationStore(sql),
    // Outbound mail attachments read from the org's own blob store — the
    // files domain refuses a ref outside the org before any byte moves.
    mailAttachments: ({ organizationId, storageRef }) =>
      getOrgBlobBytes(sql, organizationId, storageRef),
    ...(mailTransportOverride !== undefined
      ? { mailTransport: mailTransportOverride }
      : {}),
  });
}

export interface RunConnectorArgs {
  organizationId: string;
  connector: string;
  action: string;
  input: unknown;
  credentialRef?: string;
  mode?: 'mock' | 'live';
  caller: ConnectorCaller;
  idempotencyKey?: string;
  /**
   * A live sandbox session to run a yaml-js body IN, out of process. Only
   * the external-turn bridge owns one; without it a live yaml-js body
   * refuses on the data-only in-process runner (which cannot carry host
   * capabilities). The runner is per-invocation ON PURPOSE — the
   * process-global slot is shared by every concurrent org.
   */
  execSessionId?: string;
}

/**
 * Invoke one connector action — the platform's single door. Coded refusals
 * surface as {@link ConnectorError}; callers branch on `code`.
 */
export async function runConnectorAction(
  sql: Sql,
  args: RunConnectorArgs,
): Promise<ConnectorDispatchResult> {
  assembleConnectorHost(sql);
  // Out-of-process live execution: the session-bound sandbox-exec runner
  // plus the one-run capability its in-sandbox façade phones home with. No
  // HMAC root ⇒ no token ⇒ fall back to the in-process refusal rather than
  // running a body whose `ctx.http` could not be mediated.
  let portableRunner:
    | { codeRunner: CodeRunner; portableHost: PortableHostCall }
    | undefined;
  if (args.execSessionId !== undefined && args.mode === 'live') {
    const token = await signHostcallToken({
      org: args.organizationId,
      connector: args.connector,
      action: args.action,
      ...(args.credentialRef !== undefined
        ? { credentialRef: args.credentialRef }
        : {}),
    });
    if (token === null) {
      console.warn(
        '[connectors] no HMAC root configured — live sandbox execution unavailable, falling back to the in-process refusal',
      );
    } else {
      portableRunner = {
        codeRunner: codeRunnerForSession(args.execSessionId),
        portableHost: { url: connectorsHostcallUrlForSessions(), token },
      };
    }
  }
  return executeConnectorAction({
    connector: args.connector,
    action: args.action,
    input: args.input,
    ...(args.credentialRef !== undefined
      ? { credentialRef: args.credentialRef }
      : {}),
    caller: args.caller,
    ctx: {
      organizationId: args.organizationId,
      ...(args.mode !== undefined ? { mode: args.mode } : {}),
      credentials: credentialResolver(sql),
      approvals: approvalGate(sql),
      audit: auditSink(sql),
      ...(args.idempotencyKey !== undefined
        ? { idempotencyKey: args.idempotencyKey }
        : {}),
      ...(portableRunner !== undefined ? portableRunner : {}),
    },
  });
}

/** Where a session's CONTAINER reaches the host-call door (the same origin
 * contract the staging callback and the tools bridge use). */
export function connectorsHostcallUrlForSessions(): string {
  const origin = (
    process.env.SANDBOX_HTTP_API_BASE_URL ?? 'http://backend-api:3005'
  ).replace(/\/$/, '');
  return `${origin}/api/connectors/hostcall`;
}
