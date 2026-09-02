import { FileIcon, ImageIcon, MusicIcon, VideoIcon } from 'lucide-react';

import type { Message as ConversationMessage } from '../../types';

export interface AttachedFile {
  id: string;
  file: File | null;
  type: 'image' | 'video' | 'audio' | 'document';
}

export interface MessageEditorProps {
  placeholder?: string;
  disabled?: boolean;
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
  onConversationResolved?: () => void;
  pendingMessage?: Pick<ConversationMessage, 'id' | 'content'>;
  /**
   * Fired on a successful send, before the editor remounts. Callers that seed
   * via `pendingMessage` (undo-send restore) must clear that seed here so the
   * remount does not re-initialize from a still-present draft — send runs
   * inside `startTransition`, so clearing the seed at send-start can lag the
   * remount.
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

export function getFileType(file: File): AttachedFile['type'] {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'document';
}

export function getFileIcon(type: AttachedFile['type'], size = 'size-4') {
  const { Icon, colorClass } =
    FILE_TYPE_ICONS[type] ?? FILE_TYPE_ICONS.document;
  return <Icon className={`${size} ${colorClass}`} />;
}
