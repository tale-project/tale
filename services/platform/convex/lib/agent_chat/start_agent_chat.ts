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

import { isAudioOrVideo, isSpreadsheet } from '../../../lib/shared/file-types';
import { components, internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { createAuditLog } from '../../audit_logs/helpers';
import { checkBudget } from '../../governance/budget_enforcement';
import { resolveFeatureFlags } from '../../governance/feature_enforcement';
import { resolveBudgetContext } from '../../governance/resolve_budget_context';
import { resolveOrgSlug } from '../../organizations/resolve_org_slug';
import { persistentStreaming } from '../../streaming/helpers';
import type { FileAttachment } from '../attachments';
import type { AgentType } from '../context_management/constants';
import { AGENT_CONTEXT_CONFIGS } from '../context_management/constants';
import { createDebugLog } from '../debug_log';
import { getUserTeamIds } from '../get_user_teams';
import {
  computeDeduplicationState,
  type AgentListMessagesResult,
} from '../message_deduplication';
import { sanitizeUntrustedField } from '../untrusted_content';
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
  /** User environment context (timezone, language) for template variables */
  userContext?: {
    timezone: string;
    language: string;
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
  /** @deprecated Use agentSlug instead */
  agentId?: Id<'agentBindings'>;
  /** Optional per-request generation parameters (temperature, etc.) */
  generationParams?: GenerationParams;
  /**
   * Pre-created stream ID from markGenerating. When provided, stream creation
   * and the generationStatus patch are skipped (already committed in the
   * earlier markGenerating mutation for faster subscriber notification).
   */
  preAllocatedStreamId?: string;
}

export interface StartAgentChatResult {
  messageAlreadyExists: boolean;
  /** The stream ID for the AI response (always created for async delivery). */
  streamId: string;
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

  if (args.preAllocatedStreamId) {
    streamId = args.preAllocatedStreamId;
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

  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId,
  });

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
  if (!messageAlreadyExists) {
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

  // Compute absolute deadline for this generation chain
  // Per-agent timeoutMs takes precedence over the AgentType-based default
  const deadlineMs =
    Date.now() +
    (agentConfig.timeoutMs ??
      AGENT_CONTEXT_CONFIGS[agentType]?.timeoutMs ??
      420_000);

  // Budget enforcement — if limits exceeded, save a system reply instead of generating
  const userId = thread?.userId;
  if (userId) {
    const { userTeamIds, userRole } = await resolveBudgetContext(
      ctx,
      organizationId,
      userId,
    );
    const budgetResult = await checkBudget(
      ctx,
      organizationId,
      userId,
      userTeamIds,
      userRole,
    );
    if (!budgetResult.allowed) {
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
  }

  // Feature flag enforcement — resolve per-user flags and override agent config
  let enforcedConfig = agentConfig;
  let governanceMaxContextTokens: number | undefined;

  if (userId) {
    const userTeamIds = await getUserTeamIds(ctx, userId);
    const featureFlags = await resolveFeatureFlags(
      ctx,
      organizationId,
      userId,
      userTeamIds,
    );

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
  if (isFirstMessage) {
    await ctx.scheduler.runAfter(
      0,
      internal.threads.generate_thread_title.generateThreadTitle,
      { threadId, firstMessage: messageContent, organizationId },
    );
  }

  // Direct-mode image-generation agents skip the tool-loop pipeline — the
  // user's latest message is sent straight to an image model.
  if (enforcedConfig.primaryBehavior === 'image-generation') {
    const imageAttachments = (actionAttachments ?? []).filter((a) =>
      a.fileType.startsWith('image/'),
    );
    const orgSlug = await resolveOrgSlug(ctx, organizationId);

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
        orgSlug,
        organizationId,
        userId: thread?.userId,
      },
    );

    return { messageAlreadyExists, streamId };
  }

  // Schedule the generic agent action with full configuration
  debugLog('SCHEDULE_ACTION', {
    threadId,
    deadlineMs: new Date(deadlineMs).toISOString(),
    timestamp: new Date().toISOString(),
  });
  await ctx.scheduler.runAfter(
    0,
    internal.lib.agent_chat.internal_actions.runAgentGeneration,
    {
      agentType,
      agentConfig: enforcedConfig,
      model,
      provider,
      debugTag,
      enableStreaming,
      hooks,
      threadId,
      organizationId,
      userId: thread?.userId,
      agentSlug: args.agentSlug,
      promptMessage: messageContent,
      originalUserText: trimmedMessage,
      attachments: actionAttachments,
      streamId: streamId || undefined,
      promptMessageId,
      maxSteps,
      additionalContext,
      userContext,
      deadlineMs,
      generationParams: args.generationParams,
      maxContextTokens: governanceMaxContextTokens,
      threadTeamId: threadMeta?.teamId,
    },
  );

  return { messageAlreadyExists, streamId };
}

/**
 * Check if a file is a text file based on type or extension.
 */
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
        // JOIN by storageId; legacy fileMetadata.sourceUrl/etc kept as
        // fallback for rows from older orchestrator builds.
        const videoLink = await ctx.db
          .query('videoLinkJobs')
          .withIndex('by_threadId') // any index ordering is fine — we filter
          .filter((q) => q.eq(q.field('storageId'), attachment.fileId))
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
          // Attacker-controlled fields from yt-dlp metadata: title,
          // uploader, platform string. Strip newlines + zero-width chars
          // and clamp length before interpolating into the user-role
          // message text; then wrap the whole video block in
          // <untrusted_source> so the trust-rules system prompt applies.
          const safeTitle = sanitizeUntrustedField(
            videoTitle ?? attachment.fileName,
            120,
          );
          const safeUploader = videoUploader
            ? sanitizeUntrustedField(videoUploader, 80)
            : '';
          const safePlatform = sourcePlatform
            ? sanitizeUntrustedField(sourcePlatform, 32)
            : '';
          const platformNote = safePlatform ? ` from ${safePlatform}` : '';
          const uploaderNote = safeUploader
            ? `, uploader: ${safeUploader}`
            : '';
          const durSec = videoDurationSec ?? meta.transcriptionDurationSec ?? 0;
          const durText =
            durSec >= 3600
              ? `${Math.floor(durSec / 3600)}h ${Math.floor((durSec % 3600) / 60)}m`
              : `${Math.round(durSec / 60)}m`;
          // Keep the inline reference as short as the image / document
          // branches above. The previous template was ~5 lines of prose
          // ("— transcript stored as a document; paragraphs prefixed
          // [HH:MM:SS] timestamps — cite them when summarizing. Call
          // document_retrieve with fileId=…") which only ever lived in
          // the user-visible bubble (LLM gets the same instruction from
          // `document_retrieve`'s tool description and from
          // `agent_response/build_system_prompt`'s TRUST RULES). That
          // body-text bloat was the dominant cause of the visible
          // optimistic→persisted reflow ("bounce" — ResizeObserver
          // refires scrollTo when content grows). Shrunk to one
          // descriptive line + the fileId footer so the persisted
          // bubble's height delta vs. optimistic matches the image /
          // document path that the user has already confirmed feels
          // natural. The fileId is still in scope for the agent to call
          // `document_retrieve` / `rag_search`.
          //
          // Functional invariants preserved:
          //   - "View Transcript" button rendering (file-displays.tsx,
          //     drives off fileMetadata via useQuery — not from this
          //     markdown string)
          //   - Transcript blob in _storage (insertSyntheticFileMetadata
          //     / transcribe_audio paths unchanged)
          //   - Group 1 `<untrusted_source>` wrap at retrieve_document /
          //     rag_search tool-response boundary
          const inner = `${icon} [${safeTitle}] (video${platformNote}, ${durText}${uploaderNote})\n*(fileId: ${attachment.fileId} | fileName: ${attachment.fileName} | fileType: ${attachment.fileType} | fileSize: ${attachment.fileSize})*`;
          audioMarkdown.push(inner);
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
