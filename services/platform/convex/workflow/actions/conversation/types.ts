import type { Id } from '../../../_generated/dataModel';

export type UpdateConversationsResult = {
  success: boolean;
  updatedCount: number;
  updatedIds: Id<'conversations'>[];
};

export type QueryResult<T = unknown> = {
  page: T[];
  isDone: boolean;
  continueCursor: string | null;
  count: number;
};

export type ConversationStatus = 'open' | 'closed' | 'archived' | 'spam';

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
    filename: string;
    contentType: string;
    size: number;
  }>;
};

