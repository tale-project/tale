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
  type WorkflowTaskStore,
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
import { createHubDocument, listDocuments } from '../documents/service.ts';
import { getProjectAuthContext } from '../projects/service.ts';
import { addTaskComment, listTaskComments } from '../tasks/comments.ts';
import {
  agentUpdateTaskStatusTrusted,
  loadTaskOrThrow,
} from '../tasks/service.ts';
import { pgWebdavStore } from '../webdav/connector-store.ts';

/**
 * The 0.5 door to the connector dispatcher — the twin of
 * `convex/connectors/execute_action.ts`: assembles the REUSED engine seams
 * (catalog + registry, the node-vm code runner, the native backends) and
 * supplies the PG credential resolver, the approvals gate, and the audit
 * sink, so the mailbox sync, automation connector nodes, and (later) chat
 * tools all invoke connectors the same way.
 *
 * INTERNAL by contract — callers do their own authorization first.
 *
 * Deliberately fail-loud until its domain lands: the sandbox script runner
 * (it says what is missing instead of silently degrading). Live yaml-js bodies run on the data-only in-process
 * runner, which refuses host capabilities by design — the out-of-process
 * sandbox runner rides the external-turn bridge increment.
 */

let mailTransportOverride: MailTransport | undefined;

/** Integration seam: inject a fake IMAP/SMTP transport. Pass undefined to
 * restore the real clients. */
export function setMailTransportForTesting(
  transport: MailTransport | undefined,
): void {
  mailTransportOverride = transport;
}

const failLoudScriptRunner: SandboxScriptRunner = async () => {
  throw new ConnectorError(
    'NATIVE_IMPL_UNAVAILABLE',
    'sandbox.run_script is not available yet on this deployment',
  );
};

/** The task natives over the 0.5 tasks domain — trusted writes (the
 * connector door's callers own authorization), the 0.4 platform-store
 * semantics. */
function pgTaskStore(sql: Sql): WorkflowTaskStore {
  const systemAuth = async (organizationId: string) =>
    getProjectAuthContext(sql, {
      organizationId,
      userId: 'system',
      role: 'owner',
    });
  return {
    async get({ organizationId, taskId }) {
      try {
        const task = await loadTaskOrThrow(sql, taskId);
        if (task.organizationId !== organizationId) return null;
        return {
          taskId: task.id,
          title: task.title,
          status: task.status,
          ...(task.description !== null
            ? { description: task.description }
            : {}),
          projectId: task.projectId,
        };
      } catch {
        return null;
      }
    },
    async updateStatus({ organizationId, taskId, status }) {
      const result = await sql.begin((tx) =>
        agentUpdateTaskStatusTrusted(tx, {
          organizationId,
          actorId: 'workflow',
          taskId,
          status,
        }),
      );
      return result;
    },
    async comment({ organizationId, taskId, body }) {
      const auth = await systemAuth(organizationId);
      const result = await sql.begin((tx) =>
        addTaskComment(tx, auth, {
          taskId,
          body,
          author: { actorType: 'agent', actorId: 'workflow' },
        }),
      );
      return { messageId: result.messageId };
    },
    async listComments({ organizationId, taskId }) {
      const auth = await systemAuth(organizationId);
      const comments = await listTaskComments(sql, auth, taskId);
      return comments.map((comment) => ({
        authorType:
          comment.authorType === 'user'
            ? ('user' as const)
            : ('agent' as const),
        authorId: comment.authorId,
        body: comment.body,
        createdAt: comment.createdAt,
      }));
    },
  };
}

/** The document natives over the 0.5 documents domain. */
function pgDocumentStore(sql: Sql): WorkflowDocumentStore {
  const systemAuth = async (organizationId: string) =>
    getProjectAuthContext(sql, {
      organizationId,
      userId: 'system',
      role: 'owner',
    });
  return {
    async listFolder({ organizationId, folderId }) {
      if (folderId === undefined) return null;
      const auth = await systemAuth(organizationId);
      const docs = await listDocuments(sql, auth, { folderId });
      return {
        files: docs.map((doc) => ({
          name: doc.title ?? doc.id,
          storageId: doc.fileRef ?? doc.id,
        })),
        truncated: false,
      };
    },
    async create({ organizationId, folderId, name, content, contentType }) {
      const auth = await systemAuth(organizationId);
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
    ingestEmails: (args) => ingestEmails(shim(), args),
    ingestSentEmails: (args) => ingestSentEmails(shim(), args),
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
        'APPROVAL_GATE_MISSING',
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
    sandboxScripts: failLoudScriptRunner,
    tasks: pgTaskStore(sql),
    documents: pgDocumentStore(sql),
    conversations: pgConversationStore(sql),
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
