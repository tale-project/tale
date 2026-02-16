export type QueryResult<T = unknown> = {
  page: T[];
  isDone: boolean;
  continueCursor: string;
};

export type ConversationStatus = 'open' | 'closed' | 'archived' | 'spam';

export type ConversationPriority = 'low' | 'medium' | 'high' | 'urgent';

export type EmailType = {
  uid: number;
  messageId: string;
  from: Array<{ name?: string; address: string }>;
  to: Array<{ name?: string; address: string }>;
  cc?: Array<{ name?: string; address: string }>;
  bcc?: Array<{ name?: string; address: string }>;
  subject: string;
  date: string;
  text?: string;
  html?: string;
  flags: string[];
  headers?: Record<string, string>;
  attachments?: Array<{
    id: string;
    filename: string;
    contentType: string;
    size: number;
    contentId?: string;
  }>;
  direction?: 'inbound' | 'outbound';
};
