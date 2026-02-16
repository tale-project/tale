export interface FilePart {
  type: 'file';
  mediaType: string;
  filename?: string;
  url: string;
}

export interface Message {
  id: string;
  key: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  fileParts?: FilePart[];
  _creationTime?: number;
}
