import { Id } from '@/convex/_generated/dataModel';

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
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  isStreaming?: boolean;
  attachments?: FileAttachment[];
  fileParts?: FilePart[];
  threadId?: string;
}
