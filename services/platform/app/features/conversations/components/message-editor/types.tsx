import { FileIcon, ImageIcon, MusicIcon, VideoIcon } from 'lucide-react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

import type { Message as ConversationMessage } from '../../types';

/** A file whose bytes are already in storage, named as the send doors take
 * it. An undone send hands its files back in this shape. */
export interface StoredAttachment {
  storageId: string;
  fileName: string;
  contentType: string;
  size: number;
}

export interface AttachedFile {
  id: string;
  file: File | null;
  type: 'image' | 'video' | 'audio' | 'document';
  /** Set when the bytes are already in storage — a file an undone send
   * handed back. A send names this blob instead of uploading `file`. */
  stored?: StoredAttachment;
}

export interface MessageEditorProps {
  placeholder?: string;
  disabled?: boolean;
  /**
   * Explains why send is soft-disabled (hover + focus tooltip). Used when the
   * compose surface blocks send for a setup reason (no email connector) or
   * incomplete fields — not for the editor's own empty-body gate.
   */
  sendDisabledReason?: ReactNode;
  /**
   * A send of this draft is still in flight, started before the editor
   * remounted (e.g. Compose closed and reopened mid-send): hold the body,
   * files and Send as the editor's own send does, until it settles.
   */
  sending?: boolean;
  /** Resolve only after sending succeeds; reject to retain the draft/files
   * and let the editor report the failure. */
  onSave?: (
    message: string,
    attachments?: AttachedFile[],
    /**
     * The editor's markdown state at send time. Callers pass it to the send
     * mutation, which stores it in message metadata so an undo-send can hand
     * the draft back — it is never part of the outbound email.
     */
    sourceMarkdown?: string,
  ) => void | Promise<void>;
  messageId?: string;
  businessId?: string;
  conversationId?: string;
  /**
   * Where this reply leaves from, already localized — the server derives the
   * route from the conversation, so the composer states it rather than
   * choosing it. Absent when the thread names no channel.
   */
  replyDestination?: string;
  onConversationResolved?: () => void;
  /**
   * A draft to seed the composer with: an agent-drafted reply awaiting a
   * person, or a send the person just undid. `attachments` are that send's
   * files, handed back already in storage.
   */
  pendingMessage?: Pick<ConversationMessage, 'id' | 'content'> & {
    attachments?: AttachedFile[];
  };
  /** Keep live files with the caller when it switches between reply editors. */
  attachments?: AttachedFile[];
  onAttachmentsChange?: Dispatch<SetStateAction<AttachedFile[]>>;
  /** Fired once a seed is applied, so it cannot overwrite later draft edits. */
  onPendingMessageApplied?: (
    message: NonNullable<MessageEditorProps['pendingMessage']>,
  ) => void;
  /**
   * Fired on a successful send, before the editor remounts. A caller keeping
   * its seed until send completes can clear it here in the same React batch
   * as the remount. Undo drafts instead clear on application so navigation
   * preserves subsequent edits.
   */
  onPendingMessageConsumed?: () => void;
  hasMessageHistory?: boolean;
  organizationId: string;
}

/**
 * localStorage keys the `MessageEditor` persists its draft under, per user +
 * `messageId` (falling back to a shared `new` slot). Exported as the single
 * source of truth so a caller that owns the composer's lifecycle (e.g. the
 * compose pane) can clear the same body/instruction drafts it can't reach
 * through the editor's internal state.
 */
export function messageDraftKeys(
  userId: string | undefined,
  messageId: string | undefined,
): { body: string; improveInstruction: string } {
  const prefix = userId ? `conversation-${userId}` : 'conversation';
  const base = `${prefix}-${messageId ?? 'new'}`;
  return { body: base, improveInstruction: `${base}-improve-instruction` };
}

const FILE_TYPE_ICONS = {
  image: { Icon: ImageIcon, colorClass: 'text-blue-500' },
  video: { Icon: VideoIcon, colorClass: 'text-purple-500' },
  audio: { Icon: MusicIcon, colorClass: 'text-green-500' },
  document: { Icon: FileIcon, colorClass: 'text-muted-foreground' },
} as const;

function fileTypeOf(contentType: string): AttachedFile['type'] {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('audio/')) return 'audio';
  return 'document';
}

export function getFileType(file: File): AttachedFile['type'] {
  return fileTypeOf(file.type);
}

/** A file an undone send handed back, as the composer holds it. */
export function storedAttachedFile(stored: StoredAttachment): AttachedFile {
  return {
    id: stored.storageId,
    file: null,
    type: fileTypeOf(stored.contentType),
    stored,
  };
}

/** The full name of an attached file, whether picked or handed back. */
export function attachedFileName(attached: AttachedFile): string {
  return attached.file?.name ?? attached.stored?.fileName ?? '';
}

/** The size in bytes of an attached file, when known. */
export function attachedFileSize(attached: AttachedFile): number | undefined {
  return attached.file?.size ?? attached.stored?.size;
}

export function getFileIcon(type: AttachedFile['type'], size = 'size-4') {
  const { Icon, colorClass } =
    FILE_TYPE_ICONS[type] ?? FILE_TYPE_ICONS.document;
  return <Icon className={`${size} ${colorClass}`} />;
}
