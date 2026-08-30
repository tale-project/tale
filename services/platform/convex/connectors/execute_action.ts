'use node';

/**
 * The platform's door to the connector dispatcher.
 *
 * Everything that decides an connector call lives in `lib/connectors/`
 * (catalog resolution, schema validation, caller policy, the mediated live
 * host). This module is the wiring: it assembles the engine seams, supplies
 * the real credential resolver and the real audit sink, and exposes one
 * internal action so chat tools, conversation email replies, and actionable
 * notifications invoke connectors the same way the workflow engine does.
 *
 * INTERNAL by contract. A connector action can send mail, file issues, and
 * post to channels on the organization's behalf, so the surface that a user
 * reaches must do its own authorization first and then call in here — there is
 * no client-callable version of this function.
 *
 * The approvals gate IS wired: a `user`-initiated live write is checked through
 * the approvals domain, which records a pending approval and returns
 * `approval-required` (with the id the caller drives to resolution) rather than
 * performing an ungated write. Reads run straight through, `system` calls state
 * their reason and are recorded, and `workflow` calls are gated by the durable
 * stepper before they ever reach here.
 *
 * One capability is still deliberately NOT wired, and fails closed rather than
 * degrade:
 *
 *  - **blob storage** — no sink is passed, so `ctx.files` is absent and the
 *    attachment actions say so, rather than silently dropping bytes.
 */

import { v } from 'convex/values';

import {
  executeConnectorAction,
  installConnectorCatalog,
  type ApprovalGate,
  type CredentialResolver,
  type ConnectorAuditSink,
  type ConnectorCaller,
} from '../../lib/connectors/dispatcher';
import { ConnectorError } from '../../lib/connectors/errors';
import {
  registerNativeConnectors,
  WebdavStoreError,
  type WebdavEntry,
  type WebdavFileBytes,
  type WebdavStore,
} from '../../lib/connectors/natives';
import type { PortableHostCall } from '../../lib/connectors/portable-live';
import { registerConnector } from '../../lib/connectors/registry';
import {
  hasCodeRunner,
  setCodeRunner,
  type CodeRunner,
} from '../../lib/engine/core/runner';
import { nodeVmRunner } from '../../lib/engine/runners/node-vm';
import { AppError } from '../../lib/shared/errors/app-error';
import { backendErrorCode } from '../../lib/utils/backend-error';
import { lockKeyFromParsed } from '../../lib/webdav/paths';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import { workflowScriptRunner } from '../automations/script_host';
import { loadConnectorDefinitions } from '../connector_credentials/connector_catalog';
import { resolveConnectorCredential } from '../connector_credentials/resolve_credential';
import { fetchBlobArrayBuffer } from '../lib/storage/blob_read_any';
import { codeRunnerForSession } from '../node_only/sandbox/engine_exec_runner';
import { signHostcallToken } from './hostcall_token';
import {
  workflowConversationStore,
  workflowDocumentStore,
  workflowTaskStore,
} from './platform_stores';

/**
 * Install the seams one invocation needs. Cheap and idempotent — the catalog
 * read is memoized behind a stat of each `connector.yml`, so a connector edited
 * in a checkout is picked up on the next call without re-parsing the tree.
 *
 * The CodeRunner is the engine's sandbox seam for untrusted JavaScript. The
 * bundled node-vm backend is what runs the deterministic mock bodies; it is
 * data-only, so a `yaml-js` LIVE body needs a backend able to proxy host
 * capabilities and the dispatcher says so instead of pretending.
 *
 * The native backends are registered here too, against THIS invocation's
 * context: the WebDAV actions act through the same document store the `/dav`
 * server uses, which is reached with the running action's ctx.
 */
function assembleConnectorHost(ctx: ActionCtx): void {
  if (!hasCodeRunner()) setCodeRunner(nodeVmRunner());
  const connectors = loadConnectorDefinitions();
  installConnectorCatalog(connectors);
  for (const connector of connectors) registerConnector(connector);
  registerNativeConnectors({
    webdav: webdavStore(ctx),
    sandboxScripts: workflowScriptRunner(ctx),
    tasks: workflowTaskStore(ctx),
    documents: workflowDocumentStore(ctx),
    conversations: workflowConversationStore(ctx),
  });
}

/** The host-call endpoint as a sandbox session's CONTAINER reaches it — the
 * platform HTTP-actions origin over the sandbox network alias (the same
 * contract as the staging callback and the connectors bridge). */
function connectorsHostcallUrlForSessions(): string {
  const origin = (
    process.env.SANDBOX_HTTP_API_BASE_URL ?? 'http://convex:3211'
  ).replace(/\/$/, '');
  return `${origin}/api/connectors/hostcall`;
}

// ------------------------------------------------- the org's document store

/**
 * Who a file written by an connector belongs to. The write is the
 * organization's own automation acting, not a member — `system` is the actor
 * the platform's other unattended writes use, and keeping it means a custodian
 * legal hold (which is keyed to a member) never matches these rows while an
 * org-level hold still covers them.
 */
const CONNECTOR_ACTOR = 'system';

/** The live tree; `.trash` is not an connector surface. */
const DOCUMENTS_NAMESPACE = 'documents' as const;

/**
 * Translate a refusal from the document store into the native's vocabulary.
 *
 * These mutations are the same ones the `/dav` server calls, so their coded
 * refusals — most importantly `LEGAL_HOLD_ACTIVE`, raised by the WebDAV hold
 * guard before anything is trashed or overwritten — arrive here unchanged and
 * must keep their meaning: a held file is refused, never retried or worked
 * around. Anything uncoded is rethrown as itself.
 */
function translateStoreFailure(error: unknown): never {
  switch (backendErrorCode(error)) {
    case 'LEGAL_HOLD_ACTIVE':
      throw new WebdavStoreError(
        'legal-hold',
        'the content is under a legal hold',
      );
    case 'CONFLICT':
      // Raised when a parent folder is missing (a write never creates one) and
      // when a tree is nested deeper than the store walks.
      throw new WebdavStoreError(
        'parent-missing',
        'the parent folder is not there',
      );
    case 'SUBTREE_TOO_LARGE':
      throw new WebdavStoreError(
        'too-large',
        'the folder holds more than one transaction can delete',
      );
    case 'NOT_FOUND':
    case 'INVALID_PATH':
      throw new WebdavStoreError('not-found', 'nothing is stored at that path');
    default:
      throw error;
  }
}

/**
 * The organization's file tree, reached exactly the way the `/dav` server
 * reaches it: the same internal path resolution, the same listing query, the
 * same ingest and delete mutations — and therefore the same visibility rules,
 * blob backends, and legal-hold gate. Nothing here opens a second route to org
 * files, and every call carries the organization the dispatcher resolved.
 */
function webdavStore(ctx: ActionCtx): WebdavStore {
  const resolve = async (organizationId: string, segments: readonly string[]) =>
    await ctx.runQuery(internal.webdav.tree_queries.resolvePath, {
      organizationId,
      namespace: DOCUMENTS_NAMESPACE,
      segments: [...segments],
    });

  return {
    async list({ organizationId, segments }): Promise<readonly WebdavEntry[]> {
      const resolved = await resolve(organizationId, segments);
      if (!resolved.exists) {
        throw new WebdavStoreError('not-found', 'no folder at that path');
      }
      if (resolved.kind === 'document') {
        throw new WebdavStoreError('not-a-folder', 'that path is a file');
      }
      const listing = await ctx.runQuery(
        internal.webdav.tree_queries.listCollection,
        {
          organizationId,
          namespace: DOCUMENTS_NAMESPACE,
          folderId: resolved.kind === 'folder' ? resolved.folderId : null,
        },
      );
      return [
        ...listing.folders.map((folder) => ({
          name: folder.name,
          isDir: true,
          size: 0,
        })),
        ...listing.documents.map((document) => ({
          name: document.title,
          isDir: false,
          size: document.size ?? 0,
        })),
      ];
    },

    async read({
      organizationId,
      segments,
      maxBytes,
    }): Promise<WebdavFileBytes> {
      const resolved = await resolve(organizationId, segments);
      if (!resolved.exists) {
        throw new WebdavStoreError('not-found', 'no file at that path');
      }
      if (resolved.kind !== 'document') {
        throw new WebdavStoreError('not-a-file', 'that path is a folder');
      }
      const props = await ctx.runQuery(
        internal.webdav.tree_queries.getDocumentProps,
        { organizationId, documentId: resolved.documentId },
      );
      // A document row with no blob has no bytes to serve — the same 404 the
      // DAV GET path returns for it.
      if (!props?.fileId) {
        throw new WebdavStoreError('not-found', 'that file holds no content');
      }
      // Checked from the recorded size FIRST, so an oversized blob is refused
      // without ever being pulled into the action's memory.
      if (typeof props.size === 'number' && props.size > maxBytes) {
        throw new WebdavStoreError('too-large', 'the file is above the limit');
      }
      const blob = await fetchBlobArrayBuffer(
        ctx,
        organizationId,
        props.fileId,
      );
      if (blob === null) {
        throw new WebdavStoreError('not-found', 'the stored blob is gone');
      }
      if (blob.bytes.byteLength > maxBytes) {
        throw new WebdavStoreError('too-large', 'the file is above the limit');
      }
      return {
        bytes: new Uint8Array(blob.bytes),
        contentType: props.contentType ?? blob.contentType,
      };
    },

    async write({ organizationId, segments, bytes, contentType }) {
      // Copied into an exact-size buffer: a view's own buffer may be larger
      // than the view, and the Convex argument carries the whole buffer.
      const payload = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(payload).set(bytes);
      // Bytes land in whichever backend owns the org's blobs (Convex storage,
      // or the org's own bucket) before any row references them.
      const storageId = await ctx.runAction(
        internal.files.blob_actions.storeOrgBlob,
        { organizationId, bytes: payload, contentType },
      );
      try {
        await ctx.runMutation(internal.webdav.tree_mutations.ingestPutBlob, {
          organizationId,
          pathSegments: [...segments],
          storageId,
          contentType,
          size: bytes.byteLength,
          userId: CONNECTOR_ACTOR,
        });
      } catch (error) {
        // The ingest is transactional, so a refusal (a missing parent, a legal
        // hold) leaves no row pointing at the blob just uploaded. Reclaim it,
        // or it is unreachable and never swept.
        await ctx
          .runMutation(internal.webdav.tree_mutations.deleteWebdavBlob, {
            storageId,
            organizationId,
          })
          .catch((cause: unknown) =>
            console.warn(
              '[connectors] webdav.write: reclaiming the unused blob failed',
              cause,
            ),
          );
        translateStoreFailure(error);
      }
    },

    async remove({ organizationId, segments }): Promise<boolean> {
      const resolved = await resolve(organizationId, segments);
      if (!resolved.exists) return false;
      try {
        if (resolved.kind === 'document') {
          await ctx.runMutation(
            internal.webdav.tree_mutations.softDeleteDocument,
            { organizationId, documentId: resolved.documentId },
          );
        } else if (resolved.kind === 'folder') {
          await ctx.runMutation(
            internal.webdav.tree_mutations.deleteFolderCascade,
            { organizationId, folderId: resolved.folderId },
          );
        } else {
          // The organization root itself: the native refuses this before it
          // reaches the store, and nothing else may delete a whole org tree.
          throw new WebdavStoreError(
            'not-found',
            'the organization root cannot be deleted',
          );
        }
      } catch (error) {
        translateStoreFailure(error);
      }
      // A resource's locks do not outlive it (RFC 4918 §9.6.1), and the DAV
      // server drops them on its own DELETE. Doing the same here keeps a stale
      // lock from refusing a later write at the same path. Best-effort: the
      // deletion already happened, so a failed cleanup is logged, not raised.
      await ctx
        .runMutation(internal.webdav.lock_mutations.deleteLocksUnderPath, {
          organizationId,
          resourcePath: lockKeyFromParsed({
            namespace: DOCUMENTS_NAMESPACE,
            segments: [...segments],
          }),
        })
        .catch((cause: unknown) =>
          console.warn(
            '[connectors] webdav.delete: lock cleanup failed',
            cause,
          ),
        );
      return true;
    },
  };
}

/**
 * The credential seam. The credentials domain owns decryption, status checks,
 * and building the `Authorization` header for the credential's auth method;
 * the dispatcher only asks, and the live host applies what comes back.
 */
function credentialResolver(ctx: ActionCtx): CredentialResolver {
  return {
    resolve: (organizationId, connectorSlug, credentialRef) =>
      resolveConnectorCredential(ctx, {
        organizationId,
        connectorSlug,
        ...(credentialRef !== undefined && { credentialRef }),
      }),
  };
}

/**
 * The approvals seam. A `user`-initiated live write is decided by the approvals
 * domain, which owns the policy (a write needs a human) and the record: when it
 * asks for approval it returns the pending approval's id, which the dispatcher
 * hands back so the caller can drive it to a decision — nothing here blocks a
 * function waiting for a human. A retry of the same operation after it is
 * approved finds the granted record and runs, because the gate is keyed to the
 * dispatcher's stable idempotency key for the call. A rejected operation is
 * surfaced as a coded error rather than a silent no-op.
 */
function approvalGate(ctx: ActionCtx): ApprovalGate {
  return {
    check: async (request) => {
      const decision = await ctx.runMutation(
        internal.approvals.gate.evaluateApprovalGate,
        {
          organizationId: request.organizationId,
          source: 'connector',
          resourceKey: request.idempotencyKey,
          connector: request.connector,
          action: request.action,
          effect: 'write',
          platformInternal: request.platformInternal,
          ...(request.userId !== '' && { requestedBy: request.userId }),
          input: request.input,
        },
      );
      if (decision.decision === 'allow') {
        return { status: 'allowed' };
      }
      if (decision.decision === 'needs-approval') {
        return { status: 'required', approvalId: decision.approvalId };
      }
      throw new AppError({
        code: 'APPROVAL_REJECTED',
        approvalId: decision.approvalId,
        message:
          'This operation was rejected and will not run. Ask again with a new request if it should proceed.',
      });
    },
  };
}

/**
 * The audit seam. Every invocation the dispatcher completes lands in the org's
 * audit chain under the `connector` category — mandatory for the `system`
 * caller, whose whole justification for skipping approvals is that it leaves a
 * trail naming the reason.
 */
function auditSink(ctx: ActionCtx): ConnectorAuditSink {
  return {
    record: async (entry) => {
      await ctx.runMutation(
        internal.audit_logs.internal_mutations.createAuditLog,
        {
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
          ...(entry.error !== undefined && { errorMessage: entry.error }),
          metadata: {
            mode: entry.mode,
            effects: entry.effects,
            caller: entry.callerRef,
            idempotencyKey: entry.idempotencyKey,
            ...(entry.reason !== undefined && { reason: entry.reason }),
            ...(entry.credentialId !== undefined && {
              credentialId: entry.credentialId,
            }),
          },
        },
      );
    },
  };
}

const callerValidator = v.union(
  v.object({ kind: v.literal('user'), userId: v.string() }),
  v.object({ kind: v.literal('system'), reason: v.string() }),
  v.object({
    kind: v.literal('workflow'),
    runId: v.string(),
    nodeId: v.string(),
  }),
);

const resultValidator = v.union(
  v.object({
    status: v.literal('ok'),
    connector: v.string(),
    action: v.string(),
    nodeType: v.string(),
    mode: v.union(v.literal('mock'), v.literal('live')),
    backend: v.union(
      v.literal('mock'),
      v.literal('yaml-js'),
      v.literal('native'),
    ),
    effects: v.union(v.literal('read'), v.literal('write')),
    output: v.any(),
    credentialId: v.optional(v.string()),
  }),
  v.object({
    status: v.literal('approval-required'),
    connector: v.string(),
    action: v.string(),
    nodeType: v.string(),
    approvalId: v.optional(v.string()),
    message: v.string(),
  }),
);

/**
 * Invoke one connector action for one organization.
 *
 * `mode` defaults to `mock`: reaching a vendor is always an explicit choice,
 * so a caller that forgets it gets the deterministic mock rather than a real
 * side effect.
 */
export const runConnectorAction = internalAction({
  args: {
    organizationId: v.string(),
    connector: v.string(),
    action: v.string(),
    input: v.any(),
    credentialRef: v.optional(v.string()),
    mode: v.optional(v.union(v.literal('mock'), v.literal('live'))),
    caller: callerValidator,
    /** Stable across retries of the same logical attempt. */
    idempotencyKey: v.optional(v.string()),
    /** A live sandbox session to run the yaml-js body IN (out of process).
     * Supplied by callers that own one (the external-turn bridge); without it a
     * live yaml-js body refuses on the data-only in-process runner. */
    execSessionId: v.optional(v.string()),
  },
  returns: resultValidator,
  handler: async (ctx, args) => {
    assembleConnectorHost(ctx);
    const caller: ConnectorCaller = args.caller;

    // Out-of-process live execution: a session-bound sandbox-exec runner plus
    // the host-call capability its in-sandbox façade phones back with. Minted
    // PER CALL and passed through the dispatch context — never the process-
    // global runner slot, which concurrent orgs share. Falls back to the
    // in-process refusal when the deployment cannot sign capability tokens.
    let portableRunner:
      | { codeRunner: CodeRunner; portableHost: PortableHostCall }
      | undefined;
    if (args.execSessionId !== undefined && args.mode === 'live') {
      const token = await signHostcallToken({
        org: args.organizationId,
        connector: args.connector,
        action: args.action,
        ...(args.credentialRef !== undefined && {
          credentialRef: args.credentialRef,
        }),
      });
      if (token !== null) {
        portableRunner = {
          codeRunner: codeRunnerForSession(args.execSessionId),
          portableHost: { url: connectorsHostcallUrlForSessions(), token },
        };
      } else {
        console.warn(
          '[connectors] no HMAC root configured — live sandbox execution unavailable, falling back to the in-process refusal',
        );
      }
    }

    try {
      return await executeConnectorAction({
        connector: args.connector,
        action: args.action,
        input: args.input,
        ...(args.credentialRef !== undefined && {
          credentialRef: args.credentialRef,
        }),
        caller,
        ctx: {
          organizationId: args.organizationId,
          ...(args.mode !== undefined && { mode: args.mode }),
          credentials: credentialResolver(ctx),
          approvals: approvalGate(ctx),
          audit: auditSink(ctx),
          ...(args.idempotencyKey !== undefined && {
            idempotencyKey: args.idempotencyKey,
          }),
          ...(portableRunner !== undefined && portableRunner),
        },
      });
    } catch (error) {
      // Coded refusals cross the wire as coded errors: a caller branches on
      // `code` instead of matching prose, and the hint reaches the operator.
      if (error instanceof ConnectorError) {
        throw new AppError({
          code: error.code,
          message: error.message,
          connector: error.connector ?? args.connector,
          action: error.action ?? args.action,
          ...(error.hint !== undefined && { hint: error.hint }),
        });
      }
      throw error;
    }
  },
});
