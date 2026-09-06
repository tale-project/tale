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
    storageId?: string;
    url?: string;
    /** Transient — stripped before metadata/persist; sync materializes bytes. */
    contentBase64?: string;
    /** The connector fetched the part but it exceeded its inline cap, so no
     * bytes were carried; persisted so the chip can say why it cannot open. */
    truncated?: boolean;
  }>;
  direction?: 'inbound' | 'outbound';
};
