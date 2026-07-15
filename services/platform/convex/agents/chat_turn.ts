/**
 * Track B chat entry — a V8 mutation (NOT a `'use node'` action).
 *
 * Running the orchestration in the Convex backend isolate (not the single-
 * threaded Node executor) is the whole point: it cannot CPU-saturate the Node
 * event loop, so the scheduled `runChatTurnGeneration` node action starts on a
 * free loop in ~20ms instead of waiting ~800ms behind a concurrently-running
 * `chatWithAgent` node action (the measured root cause of the pre-stream gap).
 *
 * This mutation does ONLY fast DB work: authenticate, mark the thread
 * generating (so the client spinner + stream subscription light up
 * immediately), and schedule the node action that does the disk-bound
 * resolution + generation. It returns `{ streamId }` right away — the client
 * subscribes to the stream by threadId and ignores the return value.
 *
 * Disk-bound validation (agent-config read, guardrails sanitize) + the
 * agent-config-dependent model-access gate move into the scheduled node action,
 * so those (rare) failures surface asynchronously via thread state; the client
 * `precheckInput` already covers the guardrails-block UX before send.
 */

import { ConvexError, v } from 'convex/values';

import {
  AUTO_AGENT_SLUG,
  DEFAULT_CHAT_AGENT_SLUG,
} from '../../lib/shared/constants/agents';
import {
  type AttachmentCapInput,
  CHAT_MAX_FILE_COUNT,
  CHAT_MAX_TOTAL_SIZE,
  CHAT_UPLOAD_ALLOWED_TYPES,
  getMaxFileSizeForType,
  validateAttachmentCaps,
} from '../../lib/shared/file-types';
import { isTextBasedFile } from '../../lib/utils/text-file-types';
import { internal } from '../_generated/api';
import { mutation } from '../_generated/server';
import { notifyChatMentions } from '../collab/notify';
import {
  excludeKbReferenceTokens,
  resolveSurfaceMentions,
} from '../collab/resolve_surface_mentions';
import { isDrainingNow } from '../control/drain';
import { userContextValidator } from '../lib/agent_response/validators';
import { assertThreadAccess } from '../lib/rls/auth/can_access_thread';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { blobRefValidator } from '../lib/storage/blob_ref';
import { persistentStreaming } from '../streaming/helpers';
import { cancelGeneration } from '../threads/cancel_generation';
import { normalizeMessageKey } from './auto_route_helpers';
import {
  MAX_KB_REFERENCES,
  resolveReferencedFiles,
} from './resolve_referenced_files';
import { resolveReferencedFolders } from './resolve_referenced_folders';

export type ChatAttachmentCapInput = AttachmentCapInput;

/**
 * Re-enforce the composer's attachment caps server-side: max file count,
 * per-file size (type-aware — audio/video get the higher transcription-pipeline
 * ceiling), total size, and the MIME allowlist (mirroring the client's
 * `isTextBasedFile` fallback for text-like files outside the strict list).
 * `chatWithAgentTurn` is a public mutation, so a scripted client bypassing
 * `useConvexFileUpload`'s gates could otherwise attach an unbounded
 * `attachments[]` — same class of gap `validateTaskAttachments`
 * (`convex/tasks/attachments.ts`) closes for tasks and
 * `validateConversationAttachmentCaps` (`convex/conversations/attachments.ts`)
 * closes for outbound email. Uses the same shared caps the client enforces
 * (`lib/shared/file-types.ts`), through the generic `validateAttachmentCaps`
 * check those two share, so the surfaces can't drift apart.
 */
export function validateChatAttachmentCaps(
  attachments: ChatAttachmentCapInput[] | undefined,
): void {
  validateAttachmentCaps(attachments, {
    maxCount: CHAT_MAX_FILE_COUNT,
    totalMaxSize: CHAT_MAX_TOTAL_SIZE,
    isAllowedType: (att) =>
      CHAT_UPLOAD_ALLOWED_TYPES.includes(att.fileType) ||
      isTextBasedFile(att.fileName, att.fileType),
    maxSizeForType: getMaxFileSizeForType,
    errorCodes: {
      tooMany: 'CHAT_ATTACHMENTS_TOO_MANY',
      typeInvalid: 'CHAT_ATTACHMENT_TYPE_INVALID',
      tooLarge: 'CHAT_ATTACHMENT_TOO_LARGE',
      totalTooLarge: 'CHAT_ATTACHMENTS_TOTAL_SIZE_EXCEEDED',
    },
  });
}

export const chatWithAgentTurn = mutation({
  args: {
    agentSlug: v.string(),
    threadId: v.string(),
    organizationId: v.string(),
    message: v.string(),
    maxSteps: v.optional(v.number()),
    attachments: v.optional(
      v.array(
        v.object({
          // Blob reference (`_storage` id or `s3:` ref) — see lib/storage/blob_ref.
          fileId: blobRefValidator,
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
    modelId: v.optional(v.string()),
    capabilityBindings: v.optional(v.array(v.string())),
    additionalContext: v.optional(v.record(v.string(), v.string())),
    userContext: v.optional(userContextValidator),
    projectId: v.optional(v.id('projects')),
    /**
     * Knowledge-base documents the user pinned to this turn via the
     * composer's `@`-mention picker (cap 5). Validated synchronously
     * (org/team access, active, RAG-indexed) — an invalid reference throws
     * `KB_REF_INVALID` before anything is marked generating.
     */
    referencedDocumentIds: v.optional(v.array(v.id('documents'))),
    /**
     * Knowledge-base FOLDERS pinned via the same picker. Each expands to
     * its subtree's RAG-indexed documents at send time (bounded); documents
     * and folders share the cap of 5 references per turn.
     */
    referencedFolderIds: v.optional(v.array(v.id('folders'))),
    /**
     * Cache pre-warm. Fired on composer focus/typing: resolves the agent +
     * config exactly as a real turn would and primes the prompt cache with one
     * throwaway generation — NO markGenerating, NO stream, NO saved message, NO
     * title, NO supersede. Routed to the default chat agent for Auto (skip the
     * classifier — the real turn may route elsewhere anyway). Best-effort.
     */
    prewarm: v.optional(v.boolean()),
    // Arena: when this turn is the ROOT side (thread A) of an A/B comparison,
    // the branch-thread id (thread B). The branch link is created from the
    // node action AFTER this thread's user message is saved — creating it
    // eagerly in arenaChat raced the async save and threw on the first turn.
    arenaBranchThreadId: v.optional(v.string()),
  },
  returns: v.object({
    messageAlreadyExists: v.boolean(),
    streamId: v.string(),
    unresolvedMentionTokens: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const requestStartMs = Date.now();

    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    // Server-side re-enforcement of the composer's attachment caps — BEFORE
    // the prewarm branch, since prewarm forwards `attachments` to the same
    // generation action. A denial throws synchronously; nothing is committed.
    validateChatAttachmentCaps(args.attachments);

    // Projects: validate access BEFORE the prewarm branch (a denial throws
    // synchronously and the client shows a PROJECT_* toast — same UX as
    // before Track B). Prewarm forwards projectId to the generation action,
    // whose startChat persists the thread↔project binding — an unvalidated
    // prewarm must never bind a caller's thread to a project they can't
    // access. The PROJECT_MISMATCH check stays below (needs thread meta).
    if (args.projectId) {
      const projectAccess = await ctx.runQuery(
        internal.projects.internal_queries.assertProjectAccessForChat,
        {
          projectId: args.projectId,
          organizationId: args.organizationId,
          userId: authUser.userId,
        },
      );
      if (!projectAccess.allowed) {
        throw new ConvexError({
          code:
            projectAccess.reason === 'not_found'
              ? 'PROJECT_NOT_FOUND'
              : projectAccess.reason === 'org_mismatch'
                ? 'PROJECT_ORG_MISMATCH'
                : 'PROJECT_FORBIDDEN',
        });
      }
    }

    // Cache pre-warm: invisible. Skip markGenerating / stream / supersede /
    // project persist entirely — just schedule the throwaway priming
    // generation. Don't spend a routing classifier on a prewarm (the real turn
    // may route elsewhere); prime the default agent's prefix (the common case).
    if (args.prewarm) {
      await ctx.scheduler.runAfter(
        0,
        internal.agents.chat_turn_generate.runChatTurnGeneration,
        {
          agentSlug:
            args.agentSlug === AUTO_AGENT_SLUG
              ? DEFAULT_CHAT_AGENT_SLUG
              : args.agentSlug,
          organizationId: args.organizationId,
          message: args.message,
          modelId: args.modelId,
          attachments: args.attachments,
          capabilityBindings: args.capabilityBindings,
          additionalContext: args.additionalContext,
          userContext: args.userContext,
          maxSteps: args.maxSteps,
          projectId: args.projectId,
          threadId: args.threadId,
          // No stream for a prewarm — the generation runs in prewarm mode and
          // persists nothing.
          streamId: '',
          userId: authUser.userId,
          userEmail: authUser.email ?? '',
          userName: authUser.name ?? '',
          requestStartMs,
          prewarm: true,
        },
      );
      return {
        messageAlreadyExists: false,
        streamId: '',
        unresolvedMentionTokens: [],
      };
    }

    // Deploy drain gate: a `tale deploy` recreates the convex container in
    // place, killing every in-flight (non-durable) chat generation. While the
    // CLI is draining, refuse NEW turns so nothing starts mid-restart — the
    // client retries this coded error onto the restarted backend (mirrors the
    // sandbox spawner's 503 "draining"). Prewarm bypasses (it returned above);
    // in-flight turns keep running and the CLI waits for them.
    if (await isDrainingNow(ctx)) {
      throw new ConvexError({ code: 'BACKEND_DRAINING' });
    }

    // Thread metadata is read BEFORE resolving `@`-references: the reference
    // gate needs the thread's project scope (a project file is pinable only
    // inside its own project's chat). Also used further down for
    // markGenerating (mirrors threads/internal_mutations:markGenerating).
    const meta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    if (!meta) {
      throw new Error('Thread not found');
    }
    if (meta.userId !== authUser.userId) {
      // App-discussion threads (the AgentChat block's shared per-subject
      // thread) are a shared org surface: any current member of the thread's
      // org may send turns — mirrors `can_access_thread`'s discussion branch.
      // Every other kind stays owner-only. `assertThreadAccess` enforces org
      // membership, active-org coherence, and the retention-status gate.
      if (meta.kind !== 'automation_discussion') {
        throw new Error('Thread not found');
      }
      await assertThreadAccess(
        ctx,
        args.threadId,
        authUser,
        args.organizationId,
      );
    }
    if (meta.organizationId && meta.organizationId !== args.organizationId) {
      throw new Error('Thread does not belong to the requested organization');
    }

    // Projects: detect a thread↔project mismatch synchronously so the client
    // gets a PROJECT_MISMATCH toast (the same UX as before Track B), rather
    // than failing silently when startChat's async check throws into the node
    // action's outer catch. `meta` is already read above, so this is ~free.
    // startChat keeps the same check as defense-in-depth for other callers.
    if (args.projectId && meta.projectId && meta.projectId !== args.projectId) {
      throw new ConvexError({ code: 'PROJECT_MISMATCH' });
    }

    // Resolve + authorize `@`-mentioned knowledge-base documents BEFORE any
    // state is committed, so a stale/inaccessible reference throws
    // synchronously (client toast) and never leaves the thread generating.
    // The thread's persisted project wins; args.projectId covers the first
    // send into a not-yet-persisted project thread (access-validated above).
    const docRefCount = args.referencedDocumentIds?.length ?? 0;
    const folderRefCount = args.referencedFolderIds?.length ?? 0;
    // Documents and folders share the per-turn reference cap.
    if (docRefCount + folderRefCount > MAX_KB_REFERENCES) {
      throw new ConvexError({ code: 'KB_REF_INVALID' });
    }
    const threadProjectId = meta.projectId ?? args.projectId;
    const directFiles =
      args.referencedDocumentIds && args.referencedDocumentIds.length > 0
        ? await resolveReferencedFiles(ctx, {
            organizationId: args.organizationId,
            userId: authUser.userId,
            referencedDocumentIds: args.referencedDocumentIds,
            threadProjectId,
          })
        : undefined;
    const folderRefs =
      args.referencedFolderIds && args.referencedFolderIds.length > 0
        ? await resolveReferencedFolders(ctx, {
            organizationId: args.organizationId,
            userId: authUser.userId,
            referencedFolderIds: args.referencedFolderIds,
            threadProjectId,
          })
        : undefined;
    // Union: folder expansions defer to direct pins on the same file.
    const directFileIds = new Set(
      (directFiles ?? []).map((file) => file.fileId),
    );
    const mergedFiles = [
      ...(directFiles ?? []),
      ...(folderRefs?.files ?? []).filter(
        (file) => !directFileIds.has(file.fileId),
      ),
    ];
    const referencedFiles = mergedFiles.length > 0 ? mergedFiles : undefined;
    const referencedFolders =
      folderRefs && folderRefs.folders.length > 0
        ? folderRefs.folders
        : undefined;

    // Supersede an in-flight generation: if this thread is already generating,
    // cancel the running turn (aborts its SDK stream → the running action's
    // abort watcher stops it) before starting a new one. Prevents a concurrent
    // / cancel-then-resend send from double-generating and double-billing.
    // Reuses the same helper as the user-facing Stop, so cancel→resend keeps
    // working (no hard reject). Like Stop, the abort is poll-based (~1.5s), so
    // a near-instant prior turn may still finalize — acceptable parity.
    if (meta.generationStatus === 'generating' && meta.streamId) {
      // Cancel AS THE THREAD OWNER: `cancelGeneration` validates against the
      // agent-component thread's creator userId, which equals `meta.userId`.
      // For an owner send the two are identical; for an authorized non-owner
      // send on a shared `automation_discussion` thread (gate above) this is what
      // lets the supersede work instead of failing on the ownership check.
      await cancelGeneration(ctx, meta.userId, args.threadId);
    }

    const streamId = await persistentStreaming.createStream(ctx);
    const isAuto = args.agentSlug === AUTO_AGENT_SLUG;
    // Captured BEFORE the optimistic patch below overwrites it: the generation
    // action needs the thread's previously bound agent to enforce the
    // external-thread agent lock (a stale client selection must never re-route
    // a thread whose stored agent is an external one — the sandbox session and
    // --resume transcript are bound to it).
    const priorAgentSlug = meta.agentSlug;
    await ctx.db.patch(meta._id, {
      generationStatus: 'generating' as const,
      streamId,
      generationStartTime: Date.now(),
      updatedAt: Date.now(),
      cancelledAt: undefined,
      cancelledMessageId: undefined,
      // Clear any prior turn's live route so the UI never flashes a stale
      // "Routed to X" while this turn is still routing (mirrors
      // threads/internal_mutations:markGenerating).
      liveRoute: undefined,
      ...(isAuto ? {} : { agentSlug: args.agentSlug }),
    });

    // Route-quality feedback: the user explicitly pinned an agent. If this is
    // the SAME message a prior Auto turn routed elsewhere, that's a sound
    // misroute correction — fold it into the auto-route cache (off-path,
    // best-effort).
    if (!isAuto) {
      void ctx
        .runMutation(internal.agents.internal_mutations.recordRouteOverride, {
          threadId: args.threadId,
          organizationId: args.organizationId,
          explicitSlug: args.agentSlug,
          messageKey: normalizeMessageKey(args.message),
          nowMs: Date.now(),
        })
        .catch((err: unknown) =>
          console.warn(
            '[chatWithAgentTurn] recordRouteOverride failed:',
            err instanceof Error ? err.message : err,
          ),
        );
    }

    const projectIdForMentions = args.projectId ?? meta.projectId;
    const { mentions, unresolvedMentionTokens: rawUnresolvedTokens } =
      await resolveSurfaceMentions(ctx, {
        organizationId: args.organizationId,
        body: args.message.trim(),
        projectId: projectIdForMentions,
      });
    // `@file.pdf` / `@Folder` pins already resolved as KB references above —
    // without this exclusion every successful file mention toasts a spurious
    // "did not match anyone in your organization".
    const unresolvedMentionTokens = excludeKbReferenceTokens(
      rawUnresolvedTokens,
      [
        ...mergedFiles.map((file) => file.fileName),
        ...(referencedFolders ?? []).map((folder) => folder.name),
      ],
    );
    await notifyChatMentions(ctx, {
      organizationId: args.organizationId,
      threadId: args.threadId,
      threadTitle: meta.title ?? 'Chat',
      mentions,
      actorType: 'user',
      actorId: authUser.userId,
      projectId: projectIdForMentions,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.agents.chat_turn_generate.runChatTurnGeneration,
      {
        agentSlug: args.agentSlug,
        organizationId: args.organizationId,
        message: args.message,
        modelId: args.modelId,
        attachments: args.attachments,
        capabilityBindings: args.capabilityBindings,
        additionalContext: args.additionalContext,
        userContext: args.userContext,
        maxSteps: args.maxSteps,
        projectId: args.projectId,
        threadId: args.threadId,
        streamId,
        userId: authUser.userId,
        userEmail: authUser.email ?? '',
        userName: authUser.name ?? '',
        requestStartMs,
        arenaBranchThreadId: args.arenaBranchThreadId,
        referencedFiles,
        referencedFolders,
        priorAgentSlug,
      },
    );

    // The client subscribes to the stream by threadId and ignores this return;
    // dedup is decided in the node action (saveMessage), so report false here.
    return {
      messageAlreadyExists: false,
      streamId,
      unresolvedMentionTokens,
    };
  },
});
