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
  ) => void | Promise<void>;
  messageId?: string;
  businessId?: string;
  conversationId?: string;
  onConversationResolved?: () => void;
  pendingMessage?: Pick<ConversationMessage, 'id' | 'content'>;
  hasMessageHistory?: boolean;
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
