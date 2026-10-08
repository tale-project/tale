import type { Sql } from 'postgres';

import {
  executeConnectorAction,
  loadConnectorCatalog,
  type ApprovalGate,
  type ConnectorAuditSink,
  type ConnectorCaller,
  type ConnectorDispatchResult,
  type ConnectorUsageSink,
  type CredentialResolver,
} from '../../../lib/connectors/dispatcher.ts';
import { ConnectorError } from '../../../lib/connectors/errors.ts';
import { inProcessLiveRunner } from '../../../lib/connectors/in-process-live.ts';
import {
  registerNativeConnectors,
  type MailTransport,
  type SandboxScriptRunner,
  type WorkflowConversationStore,
} from '../../../lib/connectors/natives/index.ts';
import {
  hasCodeRunner,
  setCodeRunner,
} from '../../../lib/engine/core/runner.ts';
import { nodeVmRunner } from '../../../lib/engine/runners/node-vm.ts';
import { AUTOMATION_SUBJECT_ID } from '../../../lib/shared/constants/usage.ts';
import {
  ingestEmails,
  ingestSentEmails,
  listMailboxMessages,
  querySyncCursor,
  syncMailbox,
} from '../../core/conversations/sync_mailbox.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { evaluateApprovalGate } from '../approvals/gate.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { resolveConnectorCredential } from '../connector_credentials/service.ts';
import { draftReplyToConversation } from '../conversations/draft.ts';
import { conversationShimHandlers } from '../conversations/shim.ts';
import {
  listUntriagedConversations,
  recordConversationTriage,
} from '../conversations/triage.ts';
import { getOrgBlobBytes } from '../files/service.ts';
import { recordConnectorUsage } from '../governance/service.ts';
import {
  resolveAutomationRunAttribution,
  type SessionOpAttribution,
} from '../sandbox/op-attribution.ts';
import { pgWebdavStore } from '../webdav/connector-store.ts';
import { connectorBlobSink } from './blob-sink.ts';
import { pgDocumentStore } from './document-store.ts';
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
 * session the run's agent nodes use. A live yaml-js body runs on the
 * host-capable in-process runner (the shipped catalog is trusted code, and
 * `ctx.http` is the same policed live host either way) — the external-turn
 * bridge included, so a sandboxed agent's call never runs its body, or
 * carries its credential, inside the agent's own session.
 */

let mailTransportOverride: MailTransport | undefined;

/** The one in-process live runner — stateless, so shared by every call. */
const inProcessLive = inProcessLiveRunner();

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
    // Straight to the domain, like the draft: Inbox reads and stamps, none of
    // the reused 0.4 mail modules.
    listUntriagedConversations: (args) => listUntriagedConversations(sql, args),
    recordTriage: (args) => recordConversationTriage(sql, args),
    // Goes straight to the domain rather than through the shim: a draft is one
    // insert on app.approvals and touches none of the reused 0.4 mail modules.
    draftReply: (args) =>
      draftReplyToConversation(sql, {
        organizationId: args.organizationId,
        conversationId: args.conversationId,
        emailBody: args.body,
        source: 'automation',
        ...(args.guidelineVersion !== undefined && {
          guidelineVersion: args.guidelineVersion,
        }),
        ...(args.confidence !== undefined && { confidence: args.confidence }),
        ...(args.runId !== undefined && { runId: args.runId }),
        ...(args.nodeId !== undefined && { nodeId: args.nodeId }),
      }),
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

/**
 * Whose spend a connector call is: the spender its caller names — an
 * agent's turn names the run it works for — else an automation step's run
 * (`resolveAutomationRunAttribution`, the subject its agent and `llm` steps
 * book under), else the member who made it. The platform's own sends name
 * nobody, and are not counted.
 */
async function connectorSpender(
  sql: Sql,
  args: RunConnectorArgs,
): Promise<SessionOpAttribution | null> {
  if (args.spender !== undefined) return args.spender;
  if (args.caller.kind === 'workflow') {
    return (
      (await resolveAutomationRunAttribution(sql, {
        organizationId: args.organizationId,
        runId: args.caller.runId,
      })) ?? { userId: AUTOMATION_SUBJECT_ID }
    );
  }
  if (args.caller.kind === 'user') return { userId: args.caller.userId };
  return null;
}

/** Every live connector call that ran, counted as one under its spender —
 * at no cost and never as a model request (`recordConnectorUsage`). */
function connectorUsageSink(
  sql: Sql,
  args: RunConnectorArgs,
): ConnectorUsageSink {
  return {
    record: async (entry) => {
      const spender = await connectorSpender(sql, args);
      if (spender === null) return;
      await recordConnectorUsage(sql, {
        organizationId: entry.organizationId,
        userId: spender.userId,
        ...(spender.agentSlug !== undefined
          ? { agentSlug: spender.agentSlug }
          : {}),
        ...(spender.apiKeyId !== undefined
          ? { apiKeyId: spender.apiKeyId }
          : {}),
        ...(spender.projectIds !== undefined
          ? { projectIds: spender.projectIds }
          : {}),
        connectorName: entry.connector,
        connectorOperation: entry.action,
        costEstimateCents: 0,
        timestamp: Date.now(),
      });
    },
  };
}

/** Install the seams one invocation needs — cheap and idempotent (the
 * catalog read is stat-memoized). */
function assembleConnectorHost(sql: Sql): void {
  if (!hasCodeRunner()) setCodeRunner(nodeVmRunner());
  loadConnectorCatalog();
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
  /** Whose spend the call is, when the caller knows better than its kind:
   * an agent's turn names its run's subject — the person, the agent, the
   * API key and the projects. */
  spender?: SessionOpAttribution;
  idempotencyKey?: string;
  /**
   * Whether a live body may store files through `ctx.files` (default yes).
   * The agent bridge says no: an agent's read calls should not leave blobs
   * and file records in the organization's store, and an action that needs
   * the store refuses instead, as it always did for agent calls.
   */
  storeFiles?: boolean;
  /**
   * The caller's own stop: an automation run's turn passes its signal so a
   * live call still running when the server is shutting down is cut
   * (`INTERRUPTED`) instead of holding the walker. An in-process reference —
   * it reaches this door only through direct calls and the ctx shim, which
   * hands its arguments over untouched.
   */
  signal?: AbortSignal;
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
      usage: connectorUsageSink(sql, args),
      // `ctx.files` for an in-process live body: the org's own blob store.
      ...(args.storeFiles !== false
        ? {
            blobs: connectorBlobSink(sql, {
              organizationId: args.organizationId,
              connector: args.connector,
              caller: args.caller,
            }),
          }
        : {}),
      ...(args.idempotencyKey !== undefined
        ? { idempotencyKey: args.idempotencyKey }
        : {}),
      ...(args.signal !== undefined ? { signal: args.signal } : {}),
      // A live yaml-js body needs a host-capable runner: the in-process one,
      // never a `node -e` program in a sandbox session, whose command line
      // would carry the body's scope (credential secrets included) to every
      // process of that session. The process-global slot stays the
      // data-only runner for mock bodies.
      ...(args.mode === 'live' ? { codeRunner: inProcessLive } : {}),
    },
  });
}
