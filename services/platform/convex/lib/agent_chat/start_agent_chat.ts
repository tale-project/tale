/**
 * Start Agent Chat - Generic Mutation Helper
 *
 * Provides unified chat initialization logic for all agents:
 * - Create persistent text stream (if enabled)
 * - Deduplicate user messages
 * - Process attachments and save message
 * - Schedule agent response action
 *
 * Each agent can use this helper with their specific configuration.
 * Configuration is passed as parameters - lib/ has no dependencies on agents/.
 */

import { listMessages, saveMessage } from '@convex-dev/agent';
import type { FunctionArgs } from 'convex/server';

import { isAudioOrVideo, isSpreadsheet } from '../../../lib/shared/file-types';
import { formatVideoLinkAttachmentMarkdown } from '../../../lib/shared/video-link-markdown';
import { components, internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { createAuditLog } from '../../audit_logs/helpers';
import { checkBudget } from '../../governance/budget_enforcement';
import { resolveFeatureFlags } from '../../governance/feature_enforcement';
import { resolveBudgetContext } from '../../governance/resolve_budget_context';
import { persistentStreaming } from '../../streaming/helpers';
import type { AutoRouteReason } from '../../streaming/validators';
import type { FileAttachment } from '../attachments';
import type { AgentType } from '../context_management/constants';
import { AGENT_CONTEXT_CONFIGS } from '../context_management/constants';
import { createDebugLog } from '../debug_log';
import {
  computeDeduplicationState,
  type AgentListMessagesResult,
} from '../message_deduplication';
import type {
  SerializableAgentConfig,
  AgentHooksConfig,
  GenerationParams,
} from './types';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[startAgentChat]');

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(1)} MB`;
  }
  const gb = mb / 1024;
  if (gb < 1024) {
    return `${gb.toFixed(1)} GB`;
  }
  const tb = gb / 1024;
  return `${tb.toFixed(1)} TB`;
}

export interface StartAgentChatArgs {
  ctx: MutationCtx;
  agentType: AgentType;
  threadId: string;
  organizationId: string;
  message: string;
  maxSteps?: number;
  attachments?: FileAttachment[];
  /** Additional context to pass to the agent (key-value pairs) */
  additionalContext?: Record<string, string>;
  /** User environment context (timezone, language, UI locale) for template variables */
  userContext?: {
    timezone: string;
    language: string;
    /** App UI locale (i18n), preferred over the browser locale for the
     * response-language fallback when the user's input language is unclear. */
    uiLanguage?: string;
  };
  /** Agent configuration (serializable) */
  agentConfig: SerializableAgentConfig;
  /** Model to use for generation */
  model: string;
  /** Model provider name (e.g., 'openrouter'). Omit to search all providers. */
  provider?: string;
  /** Debug tag for logging */
  debugTag: string;
  /** Enable streaming response */
  enableStreaming: boolean;
  /** Optional hooks configuration (FunctionHandles) */
  hooks?: AgentHooksConfig;
  /** Agent slug (file name without extension), persisted on thread metadata */
  agentSlug?: string;
  /** Auto-route reason; forwarded to message metadata. Set only by the Auto
   *  branch in `chatWithAgent`. Absent for a pinned agent. */
  autoRouteReason?: AutoRouteReason;
  /** @deprecated Use agentSlug instead */
  agentId?: Id<'agentBindings'>;
  /**
   * Org member role already resolved upstream (the consolidated governance
   * query, or `startChat`'s `getOrganizationMember`). Threaded into
   * `resolveBudgetContext` so it skips a duplicate betterAuth member lookup
   * (~40-60ms cross-component sub-transaction). Omit to have budget resolve it.
   */
  preResolvedRole?: string;
  /**
   * User team IDs already resolved upstream (the governance query fetches them
   * for model-access). Threaded into `resolveBudgetContext` to skip
   * `getUserTeamIds`. Only consulted when `preResolvedRole` is also set.
   */
  preResolvedTeamIds?: string[];
  /** Optional per-request generation parameters (temperature, etc.) */
  generationParams?: GenerationParams;
  /**
   * Server-stamped turn-start (chatWithAgent entry, ms epoch) for TTFT
   * measurement. Threaded into the scheduled generation so `timeFromSendMs`
   * spans the full pre-stream overhead. Optional — older callers omit it.
   */
  requestStartMs?: number;
  /**
   * Pre-created stream ID from markGenerating. When provided, stream creation
   * and the generationStatus patch are skipped (already committed in the
   * earlier markGenerating mutation for faster subscriber notification).
   */
  preAllocatedStreamId?: string;
  /**
   * Absolute upper bound (ms epoch) on the computed generation deadline. For
   * callers that wait on the generation within a bounded window — e.g. the
   * Slack reply poll — so the deadline can never exceed that window and leave a
   * completed answer stranded past the poll. Omit for no cap.
   */
  maxDeadlineMs?: number;
  /**
   * Track B: when true, do all the prep (saveMessage / budget / feature-flags /
   * image-gen decision) but DO NOT `scheduler.runAfter` the generation —
   * instead return its args in `generationArgs` so a node-action caller can
   * `await ctx.runAction(runAgentGeneration, ...)`. Running generation via an
   * awaited runAction (the parent yields the Node event loop) lets it start on
   * a free loop instead of contending with a concurrently-running node action
   * — the ~800ms pre-stream gap. Omit/false preserves the legacy schedule path.
   */
  deferGeneration?: boolean;
  /**
   * Cache pre-warm. Skips all user-visible side effects (stream, generating
   * status, saving the user message, title generation) and schedules a single
   * throwaway priming generation that primes the prompt cache so the user's
   * first real message is served warm. The resolved agent config (incl.
   * feature-flag tool enforcement) is reused so the cached prefix matches the
   * real turn exactly. An over-budget prewarm is skipped silently.
   */
  prewarm?: boolean;
}

export interface StartAgentChatResult {
  messageAlreadyExists: boolean;
  /** The stream ID for the AI response (always created for async delivery). */
  streamId: string;
  /**
   * Track B (deferGeneration): the `runAgentGeneration` args to run via
   * `ctx.runAction`. Present only when `deferGeneration` was set AND generation
   * should proceed (absent for image-gen / budget-block / file-upload-block
   * early returns, which the caller treats as "turn already finalized").
   */
  generationArgs?: FunctionArgs<
    typeof internal.lib.agent_chat.internal_actions.runAgentGeneration
  >;
}

/**
 * Absolute deadline (ms epoch) for a generation chain. Per-agent `timeoutMs`
 * takes precedence over the AgentType default (else 420s). `maxDeadlineMs`, when
 * provided, caps the result — a caller waiting within a bounded window passes it
 * so the deadline can't outlast that window. `nowMs` is injectable for tests.
 */
export function computeDeadlineMs(
  agentConfig: Pick<SerializableAgentConfig, 'timeoutMs'>,
  agentType: AgentType,
  maxDeadlineMs?: number,
  nowMs: number = Date.now(),
): number {
  const deadline =
    nowMs +
    (agentConfig.timeoutMs ??
      AGENT_CONTEXT_CONFIGS[agentType]?.timeoutMs ??
      420_000);
  return Math.min(deadline, maxDeadlineMs ?? Infinity);
}

/**
 * Start a chat with an agent.
 *
 * This function handles the common mutation logic:
 * 1. Create persistent stream for async delivery
 * 2. Get thread and user team IDs
 * 3. Deduplicate and save user message
 * 4. Process attachments as markdown
 * 5. Schedule the agent response action
 */
export async function startAgentChat(
  args: StartAgentChatArgs,
): Promise<StartAgentChatResult> {
  const {
    ctx,
    agentType,
    threadId,
    organizationId,
    message,
    attachments,
    additionalContext,
    userContext,
    agentConfig,
    model,
    provider,
    debugTag,
    enableStreaming,
    hooks,
  } = args;
  const prewarm = args.prewarm === true;

  // Use caller's maxSteps if provided, otherwise use agent config's maxSteps
  const maxSteps = args.maxSteps ?? agentConfig.maxSteps ?? 20;

  // When markGenerating was called earlier (pre-allocated stream), reuse its
  // streamId and skip the generationStatus patch (already committed).
  // Otherwise create a fresh stream and mark generating here (backward compat
  // for callers that don't use the two-phase flow).
  let streamId: string;
  const threadMeta = await ctx.db
    .query('threadMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .first();

  if (prewarm) {
    // No stream, no generating status — a prewarm is invisible.
    streamId = '';
  } else if (args.preAllocatedStreamId) {
    streamId = args.preAllocatedStreamId;
    // Track B: markGenerating ran in the V8 entry mutation BEFORE auto-route
    // resolved the concrete agent, so persist the (now-resolved) slug here for
    // the UI. No-op for the legacy path (markGenerating already set it).
    if (
      threadMeta &&
      args.agentSlug &&
      threadMeta.agentSlug !== args.agentSlug
    ) {
      await ctx.db.patch(threadMeta._id, { agentSlug: args.agentSlug });
    }
  } else {
    streamId = await persistentStreaming.createStream(ctx);
    if (threadMeta) {
      await ctx.db.patch(threadMeta._id, {
        generationStatus: 'generating' as const,
        streamId,
        generationStartTime: Date.now(),
        updatedAt: Date.now(),
        cancelledAt: undefined,
        cancelledMessageId: undefined,
        ...(args.agentSlug ? { agentSlug: args.agentSlug } : {}),
        ...(args.agentId ? { agentId: args.agentId } : {}),
      });
    }
  }

  // The agent-component getThread was eliminated: `userId` comes from the
  // `threadMeta` row read above (a direct ctx.db read, no cross-component
  // sub-transaction), which mirrors the agent thread and was already verified
  // by the chatWithAgentTurn entry mutation.
  const userId = threadMeta?.userId;
  // Load recent non-tool messages for deduplication
  const existingMessages: AgentListMessagesResult = await listMessages(
    ctx,
    components.agent,
    {
      threadId,
      paginationOpts: { cursor: null, numItems: 10 },
      excludeToolMessages: true,
    },
  );

  const { lastUserMessage, messageAlreadyExists, trimmedMessage } =
    computeDeduplicationState(existingMessages, message);

  const hasAttachments = attachments && attachments.length > 0;

  // Build message content with attachment markdown
  const messageContent = hasAttachments
    ? await buildMessageWithAttachments(ctx, trimmedMessage, attachments)
    : trimmedMessage;

  // Save user message if not a duplicate
  let promptMessageId: string;
  const isFirstMessage =
    !messageAlreadyExists && existingMessages.page.length === 0;
  if (prewarm) {
    // Prewarm never persists a user message; the throwaway prompt is supplied
    // directly to the generation action below.
    promptMessageId = '';
  } else if (!messageAlreadyExists) {
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      message: { role: 'user', content: messageContent },
    });
    promptMessageId = messageId;
  } else {
    if (!lastUserMessage) {
      throw new Error(
        'Expected lastUserMessage to exist when messageAlreadyExists is true',
      );
    }
    promptMessageId = lastUserMessage._id;
  }

  // Prepare attachments for action (only if new message)
  const actionAttachments =
    !messageAlreadyExists && hasAttachments
      ? attachments.map((a) => ({
          fileId: a.fileId,
          fileName: a.fileName,
          fileType: a.fileType,
          fileSize: a.fileSize,
        }))
      : undefined;

  // Compute absolute deadline for this generation chain (capped by an optional
  // caller-supplied window — see computeDeadlineMs).
  const deadlineMs = computeDeadlineMs(
    agentConfig,
    agentType,
    args.maxDeadlineMs,
  );

  // Budget + feature-flag enforcement. Resolve the user's team context ONCE,
  // then run the budget check and feature-flag resolution CONCURRENTLY — both
  // read the same team membership, and previously each re-derived the team ids
  // (a duplicate lookup) and ran in series.
  let enforcedConfig = agentConfig;
  let governanceMaxContextTokens: number | undefined;
  if (userId) {
    const { userTeamIds, userRole } = await resolveBudgetContext(
      ctx,
      organizationId,
      userId,
      args.preResolvedRole,
      args.preResolvedTeamIds,
    );
    const [budgetResult, featureFlags] = await Promise.all([
      checkBudget(ctx, organizationId, userId, userTeamIds, userRole),
      resolveFeatureFlags(ctx, organizationId, userId, userTeamIds, userRole),
    ]);
    if (!budgetResult.allowed) {
      if (prewarm) {
        // Don't spend a priming call when over budget; nothing user-visible.
        return { messageAlreadyExists, streamId };
      }
      const budgetMessage =
        budgetResult.reason ??
        'Your usage limit has been reached for this period. Please contact your administrator.';
      await saveMessage(ctx, components.agent, {
        threadId,
        message: { role: 'assistant', content: budgetMessage },
      });
      if (threadMeta) {
        await ctx.db.patch(threadMeta._id, {
          generationStatus: 'idle' as const,
          updatedAt: Date.now(),
        });
      }

      await createAuditLog(ctx, {
        organizationId,
        actorId: userId,
        actorType: 'user',
        action: 'ai.budget_blocked',
        category: 'ai',
        resourceType: 'agent_completion',
        resourceId: threadId,
        resourceName: args.agentSlug,
        status: 'denied',
        errorMessage: budgetMessage,
        metadata: {
          threadId,
          agentType,
          model,
          reason: budgetResult.reason,
        },
      });

      return { messageAlreadyExists, streamId };
    }

    // Feature-flag enforcement — `featureFlags` was resolved in parallel with
    // the budget check above (reusing the same team context), not in a second
    // serial pass that re-derived the team ids.
    if (!featureFlags.webSearch) {
      enforcedConfig = {
        ...agentConfig,
        webSearchMode: 'off',
        convexToolNames: (agentConfig.convexToolNames ?? []).filter(
          (t) => t !== 'web',
        ),
      };
    }

    if (!featureFlags.fileUpload && attachments && attachments.length > 0) {
      await saveMessage(ctx, components.agent, {
        threadId,
        message: {
          role: 'assistant',
          content:
            'File uploads are disabled for your account by organization policy. Please contact your administrator.',
        },
      });
      if (threadMeta) {
        await ctx.db.patch(threadMeta._id, {
          generationStatus: 'idle' as const,
          updatedAt: Date.now(),
        });
      }
      return { messageAlreadyExists, streamId };
    }

    if (featureFlags.maxContextTokens != null) {
      governanceMaxContextTokens = featureFlags.maxContextTokens;
    }
  }

  // Fire-and-forget AI-generated title for the thread's first message.
  // If this fails or times out, the thread keeps its default "New Chat" title.
  // Genuinely non-awaited: the title enqueue is a DB write that sat ahead of
  // the generation schedule below, so awaiting it delayed time-to-generation on
  // every first turn. The title is cosmetic and the generation does not depend
  // on it. Skipped for prewarm (no user-visible thread yet).
  if (isFirstMessage && !prewarm) {
    void ctx.scheduler
      .runAfter(0, internal.threads.generate_thread_title.generateThreadTitle, {
        threadId,
        firstMessage: buildTitleSource(trimmedMessage, attachments),
        organizationId,
      })
      .catch((err: unknown) =>
        console.warn(
          '[start_agent_chat] thread-title schedule failed:',
          err instanceof Error ? err.message : err,
        ),
      );
  }

  // Image-generation agents don't use the cached chat-completion prefix, so
  // there's nothing to prewarm — bail out cleanly.
  if (prewarm && enforcedConfig.primaryBehavior === 'image-generation') {
    return { messageAlreadyExists, streamId };
  }

  // Direct-mode image-generation agents skip the tool-loop pipeline — the
  // user's latest message is sent straight to an image model.
  if (enforcedConfig.primaryBehavior === 'image-generation') {
    const imageAttachments = (actionAttachments ?? []).filter((a) =>
      a.fileType.startsWith('image/'),
    );
    debugLog('SCHEDULE_IMAGE_GENERATION', {
      threadId,
      model,
      hasAttachments: imageAttachments.length > 0,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.agents.image_generation.run_image_generation.runImageGeneration,
      {
        threadId,
        promptMessageId,
        modelRef: model,
        rawPrompt: trimmedMessage,
        systemInstructions: enforcedConfig.instructions || undefined,
        attachmentImages: imageAttachments.map((a) => ({
          fileId: a.fileId,
          fileName: a.fileName,
          mimeType: a.fileType,
        })),
        streamId: streamId || undefined,
        agentSlug: args.agentSlug,
        organizationId,
        userId,
      },
    );

    return { messageAlreadyExists, streamId };
  }

  // Schedule the generic agent action with full configuration
  const scheduledAtMs = Date.now();
  debugLog('SCHEDULE_ACTION', {
    threadId,
    deadlineMs: new Date(deadlineMs).toISOString(),
    timestamp: new Date().toISOString(),
    // PERF: ms from chatWithAgent entry to this schedule call (end of the
    // synchronous client-facing chain). Diagnostic — see PRE_STREAM_SUMMARY.
    sinceSendMs: args.requestStartMs
      ? scheduledAtMs - args.requestStartMs
      : undefined,
  });
  const generationArgs: FunctionArgs<
    typeof internal.lib.agent_chat.internal_actions.runAgentGeneration
  > = {
    agentType,
    agentConfig: enforcedConfig,
    model,
    provider,
    debugTag,
    // Prewarm issues a single, non-streamed throwaway generation.
    enableStreaming: prewarm ? false : enableStreaming,
    hooks,
    threadId,
    organizationId,
    userId,
    agentSlug: args.agentSlug,
    autoRouteReason: args.autoRouteReason,
    promptMessage: prewarm ? '.' : messageContent,
    originalUserText: prewarm ? '.' : trimmedMessage,
    attachments: prewarm ? undefined : actionAttachments,
    streamId: streamId || undefined,
    promptMessageId: prewarm ? undefined : promptMessageId,
    maxSteps,
    additionalContext,
    userContext,
    deadlineMs,
    generationParams: args.generationParams,
    maxContextTokens: governanceMaxContextTokens,
    threadTeamId: threadMeta?.teamId,
    prewarm,
    requestStartMs: args.requestStartMs,
    // PERF: wall-clock at schedule time so the action can measure the
    // scheduler dispatch + module-import hop. Diagnostic.
    scheduledAtMs,
  };

  // Track B: hand the generation args back so a node-action caller can run it
  // via an awaited `ctx.runAction` (parent yields → generation starts on a free
  // Node event loop, no contention). Legacy path schedules as before.
  if (args.deferGeneration) {
    return { messageAlreadyExists, streamId, generationArgs };
  }

  await ctx.scheduler.runAfter(
    0,
    internal.lib.agent_chat.internal_actions.runAgentGeneration,
    generationArgs,
  );

  return { messageAlreadyExists, streamId };
}

/**
 * Check if a file is a text file based on type or extension.
 */
/**
 * Pick the text used to generate the thread title. Prefer the user's actual
 * words; fall back to the attachment file names when the message is
 * attachment-only — never the attachment markdown/fileId metadata block, which
 * would otherwise become the title of an attachment-only chat (#1468).
 */
export function buildTitleSource(
  trimmedMessage: string,
  attachments: readonly Pick<FileAttachment, 'fileName'>[] | undefined,
): string {
  if (trimmedMessage.trim()) return trimmedMessage;
  return (
    attachments
      ?.map((a) => a.fileName)
      .filter(Boolean)
      .join(', ') ?? ''
  );
}

function isTextFile(attachment: FileAttachment): boolean {
  return (
    attachment.fileType.startsWith('text/plain') ||
    attachment.fileName.toLowerCase().endsWith('.txt') ||
    attachment.fileName.toLowerCase().endsWith('.log')
  );
}

/**
 * Build message content with attachment markdown.
 *
 * Converts attachments to markdown format (all include fileId):
 * - Documents: 📎 [filename](url) (type, size) *(fileId: xxx)*
 * - Text files: 📄 [filename](url) (size) *(fileId: xxx)*
 * - Images: ![filename](url) *(fileId: xxx)*
 */
async function buildMessageWithAttachments(
  ctx: MutationCtx,
  message: string,
  attachments: FileAttachment[],
): Promise<string> {
  // Separate images, text files, spreadsheets, audio, and other documents.
  // Audio is handled specially: the transcript (produced by transcribeAudio)
  // is inlined as text rather than attached as a link — bytes never reach
  // the chat model.
  const imageAttachments = attachments.filter((a) =>
    a.fileType.startsWith('image/'),
  );
  const spreadsheetAttachments = attachments.filter(
    (a) => !a.fileType.startsWith('image/') && isSpreadsheet(a.fileName),
  );
  // Audio AND video attachments flow through the same transcription path.
  const audioAttachments = attachments.filter((a) =>
    isAudioOrVideo(a.fileType),
  );
  const textFileAttachments = attachments.filter(
    (a) =>
      !a.fileType.startsWith('image/') &&
      !isSpreadsheet(a.fileName) &&
      !isAudioOrVideo(a.fileType) &&
      isTextFile(a),
  );
  const documentAttachments = attachments.filter(
    (a) =>
      !a.fileType.startsWith('image/') &&
      !isSpreadsheet(a.fileName) &&
      !isAudioOrVideo(a.fileType) &&
      !isTextFile(a),
  );

  // Fetch all URLs in parallel
  const [documentUrls, spreadsheetUrls, textFileUrls, imageUrls] =
    await Promise.all([
      Promise.all(
        documentAttachments.map(async (a) => ({
          attachment: a,
          url: await ctx.storage.getUrl(a.fileId),
        })),
      ),
      Promise.all(
        spreadsheetAttachments.map(async (a) => ({
          attachment: a,
          url: await ctx.storage.getUrl(a.fileId),
        })),
      ),
      Promise.all(
        textFileAttachments.map(async (a) => ({
          attachment: a,
          url: await ctx.storage.getUrl(a.fileId),
        })),
      ),
      Promise.all(
        imageAttachments.map(async (a) => ({
          attachment: a,
          url: await ctx.storage.getUrl(a.fileId),
        })),
      ),
    ]);

  let textContent = message;

  // Add document references as markdown (PDF, DOCX, PPTX, etc.)
  if (documentUrls.length > 0) {
    const docMarkdown: string[] = [];
    for (const { attachment, url } of documentUrls) {
      if (url) {
        docMarkdown.push(
          `📎 [${attachment.fileName}](${url}) (${attachment.fileType}, ${formatFileSize(attachment.fileSize)})\n*(fileId: ${attachment.fileId} | fileName: ${attachment.fileName} | fileType: ${attachment.fileType} | fileSize: ${attachment.fileSize})*`,
        );
      }
    }
    if (docMarkdown.length > 0) {
      textContent = `${message}\n\n${docMarkdown.join('\n\n')}`;
    }
  }

  // Add spreadsheet references as markdown (XLS, XLSX, CSV)
  if (spreadsheetUrls.length > 0) {
    const spreadsheetMarkdown: string[] = [];
    for (const { attachment, url } of spreadsheetUrls) {
      if (url) {
        spreadsheetMarkdown.push(
          `📊 [${attachment.fileName}](${url}) (${attachment.fileType}, ${formatFileSize(attachment.fileSize)})\n*(fileId: ${attachment.fileId} | fileName: ${attachment.fileName} | fileType: ${attachment.fileType} | fileSize: ${attachment.fileSize})*`,
        );
      }
    }
    if (spreadsheetMarkdown.length > 0) {
      textContent = textContent
        ? `${textContent}\n\n${spreadsheetMarkdown.join('\n\n')}`
        : spreadsheetMarkdown.join('\n\n');
    }
  }

  // Add text file references as markdown with fileId (TXT, LOG)
  if (textFileUrls.length > 0) {
    const textFileMarkdown: string[] = [];
    for (const { attachment, url } of textFileUrls) {
      if (url) {
        textFileMarkdown.push(
          `📄 [${attachment.fileName}](${url}) (${formatFileSize(attachment.fileSize)})\n*(fileId: ${attachment.fileId} | fileName: ${attachment.fileName} | fileType: ${attachment.fileType} | fileSize: ${attachment.fileSize})*`,
        );
      }
    }
    if (textFileMarkdown.length > 0) {
      textContent = textContent
        ? `${textContent}\n\n${textFileMarkdown.join('\n\n')}`
        : textFileMarkdown.join('\n\n');
    }
  }

  // Inline audio transcripts as text. Transcription is guaranteed to have
  // reached `completed`/`failed`/`skipped` by the time we get here thanks
  // to the client-side send-gate (`isTranscribing`) — see chat-input.tsx.
  if (audioAttachments.length > 0) {
    const audioMetadata = await Promise.all(
      audioAttachments.map(async (attachment) => {
        const meta = await ctx.db
          .query('fileMetadata')
          .withIndex('by_storageId', (q) =>
            q.eq('storageId', attachment.fileId),
          )
          .first();
        // Video-link provenance lives on `videoLinkJobs` (single writer).
        // JOIN by storageId via the dedicated `by_storageId` index — the
        // previous `by_threadId` form had no `.eq()` clause, so it was a
        // full-table scan filtered by `storageId` for every audio/video
        // attachment on every chat send. Cost grew linearly with the
        // org's lifetime video-link history.
        const videoLink = await ctx.db
          .query('videoLinkJobs')
          .withIndex('by_storageId', (q) =>
            q.eq('storageId', attachment.fileId),
          )
          .first();
        return { attachment, meta, videoLink };
      }),
    );
    // One-line reference per audio/video attachment — same compact pattern
    // as documents/spreadsheets. The transcript itself is NOT inlined (would
    // make user bubbles into walls of text for long meetings); it lives in
    // RAG where the agent can retrieve it via document_retrieve(fileId).
    const audioMarkdown: string[] = [];
    for (const { attachment, meta, videoLink } of audioMetadata) {
      const icon = attachment.fileType.startsWith('video/') ? '🎬' : '🎙️';
      if (meta?.transcriptionStatus === 'completed' && meta.transcript) {
        const durationNote = meta.transcriptionDurationSec
          ? `, ${Math.round(meta.transcriptionDurationSec)}s transcribed`
          : '';
        // Video-link provenance: prefer videoLinkJobs row (canonical
        // single-writer); fall back to legacy fileMetadata fields for
        // rows written by older orchestrator builds.
        const sourceUrl = videoLink?.sourceUrl ?? meta.sourceUrl;
        const sourcePlatform = videoLink?.sourcePlatform ?? meta.sourcePlatform;
        const videoTitle = videoLink?.videoTitle ?? meta.videoTitle;
        const videoUploader = videoLink?.videoUploader ?? meta.videoUploader;
        const videoDurationSec =
          videoLink?.videoDurationSec ?? meta.videoDurationSec;

        if (sourceUrl) {
          // Template lives in `lib/shared/video-link-markdown.ts`. This
          // block is appended to the persisted user-message body so the
          // agent can read fileId + provenance inline; the client strips
          // it back out via `stripInternalFileReferences`
          // (use-message-processing.ts) before rendering — the bubble
          // shows the video as an attachment card built from
          // `attachments[]`. Inputs are still resolved here: provenance
          // prefers `videoLinkJobs` over legacy `fileMetadata` fields,
          // and duration falls back to `transcriptionDurationSec` for
          // rows the server has but pre-yt-dlp-metadata builds wrote
          // without `videoDurationSec`.
          //
          // Functional invariants preserved:
          //   - "View Transcript" button rendering (file-displays.tsx,
          //     drives off fileMetadata via useQuery — not from this
          //     markdown string)
          //   - Transcript blob in _storage (insertSyntheticFileMetadata
          //     / transcribe_audio paths unchanged)
          //   - Group 1 `<untrusted_source>` wrap at retrieve_document /
          //     rag_search tool-response boundary
          audioMarkdown.push(
            formatVideoLinkAttachmentMarkdown({
              fileId: attachment.fileId,
              fileName: attachment.fileName,
              fileType: attachment.fileType,
              fileSize: attachment.fileSize,
              videoTitle,
              videoUploader,
              sourcePlatform,
              videoDurationSec:
                videoDurationSec ?? meta.transcriptionDurationSec,
            }),
          );
          continue;
        }
        audioMarkdown.push(
          `${icon} [${attachment.fileName}] (${attachment.fileType}${durationNote}) — transcript is stored as a document; paragraphs prefixed [HH:MM:SS] timestamps — cite them when summarizing. Call document_retrieve with fileId=${attachment.fileId} to read the full text\n*(fileId: ${attachment.fileId} | fileName: ${attachment.fileName} | fileType: ${attachment.fileType} | fileSize: ${attachment.fileSize})*`,
        );
      } else {
        const reason =
          meta?.transcriptionStatus === 'skipped'
            ? 'user skipped'
            : (meta?.transcriptionError ?? 'transcription incomplete');
        audioMarkdown.push(
          `${icon} [${attachment.fileName}] — could not be transcribed (${reason})\n*(fileId: ${attachment.fileId} | fileName: ${attachment.fileName} | fileType: ${attachment.fileType} | fileSize: ${attachment.fileSize})*`,
        );
      }
    }
    if (audioMarkdown.length > 0) {
      textContent = textContent
        ? `${textContent}\n\n${audioMarkdown.join('\n\n')}`
        : audioMarkdown.join('\n\n');
    }
  }

  // Add image references as markdown with fileId
  if (imageUrls.length > 0) {
    const imageMarkdown: string[] = [];
    for (const { attachment, url } of imageUrls) {
      if (url) {
        imageMarkdown.push(
          `![${attachment.fileName}](${url})\n*(fileId: ${attachment.fileId} | fileName: ${attachment.fileName} | fileType: ${attachment.fileType} | fileSize: ${attachment.fileSize})*`,
        );
      }
    }
    if (imageMarkdown.length > 0) {
      textContent = textContent
        ? `${textContent}\n\n${imageMarkdown.join('\n\n')}`
        : imageMarkdown.join('\n\n');
    }
  }

  return textContent;
}
