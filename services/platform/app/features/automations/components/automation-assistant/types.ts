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
  clientMessageId?: string;
}
