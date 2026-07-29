/**
 * Server-side re-enforcement of the composer's attachment caps for outbound
 * email — max file count, per-file size (type-aware — audio/video voice
 * notes get the higher transcription-pipeline ceiling), total size, and the
 * MIME allowlist. `sendMessageViaConnector` is a public mutation (and
 * `replyToConversation` / `composeEmailConversation` both delegate to it), so
 * a scripted client could otherwise attach an unbounded `attachments[]` —
 * none of these caps were re-checked here. Same class of gap
 * `validateChatAttachmentCaps` (`convex/agents/chat_turn.ts`) closes for chat
 * and `validateTaskAttachments` (`convex/tasks/attachments.ts`) closes for
 * tasks (#2661).
 *
 * Reuses the chat caps (count, total size, per-type size ceiling, MIME
 * allowlist) as the shared baseline through `validateAttachmentCaps`
 * (`lib/shared/file-types.ts`) — outbound email attachments cover the same
 * surface chat does (documents, images, audio/video), so there is no
 * separate cap to invent, and the two gates can't drift apart.
 */

import {
  type AttachmentCapsConfig,
  CHAT_MAX_FILE_COUNT,
  CHAT_MAX_TOTAL_SIZE,
  CHAT_UPLOAD_ALLOWED_TYPES,
  getMaxFileSizeForType,
  validateAttachmentCaps,
} from '../../lib/shared/file-types';
import { isTextBasedFile } from '../../lib/utils/text-file-types';

export interface ConversationAttachmentCapInput {
  fileName: string;
  contentType: string;
  size: number;
}

export function validateConversationAttachmentCaps(
  attachments: ConversationAttachmentCapInput[] | undefined,
): void {
  validateAttachmentCaps(
    attachments?.map((att) => ({
      fileName: att.fileName,
      fileType: att.contentType,
      fileSize: att.size,
    })),
    {
      maxCount: CHAT_MAX_FILE_COUNT,
      totalMaxSize: CHAT_MAX_TOTAL_SIZE,
      isAllowedType: (att) =>
        CHAT_UPLOAD_ALLOWED_TYPES.includes(att.fileType) ||
        isTextBasedFile(att.fileName, att.fileType),
      maxSizeForType: getMaxFileSizeForType,
      errorCodes: {
        tooMany: 'CONVERSATION_ATTACHMENTS_TOO_MANY',
        typeInvalid: 'CONVERSATION_ATTACHMENT_TYPE_INVALID',
        tooLarge: 'CONVERSATION_ATTACHMENT_TOO_LARGE',
        totalTooLarge: 'CONVERSATION_ATTACHMENTS_TOTAL_SIZE_EXCEEDED',
      },
    } satisfies AttachmentCapsConfig,
  );
}
