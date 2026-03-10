import type { Id } from '@/convex/_generated/dataModel';

export interface FileAttachment {
  fileId: Id<'_storage'>;
  fileName: string;
  fileType: string;
  fileSize: number;
  previewUrl?: string;
}

export interface FilePart {
  type: 'file';
  mediaType: string;
  filename?: string;
  url: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  automationContext?: string;
  fileParts?: FilePart[];
  attachments?: FileAttachment[];
  clientMessageId?: string;
}
