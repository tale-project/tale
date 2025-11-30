export interface ImapCredentials {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string; // For password-based auth
  accessToken?: string; // For OAuth2 auth
}

export interface ImapActionParams {
  // Credentials (optional if provided in variables)
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  accessToken?: string;

  // Operation details
  operation: 'list' | 'search'; // Both operations now do the same thing
  mailbox?: string; // Default: 'INBOX'

  // Fetch parameters
  afterUid?: number; // Fetch 1 email after this UID (omit to fetch latest)

  // Options
  includeAttachments?: boolean; // Include attachment metadata
  parseHtml?: boolean; // Parse HTML content
  threadSearchFolders?: string[] | string; // Folders to search for thread messages - can be array or JSON string (default: ['INBOX', '[Gmail]/Sent Mail'])
}

export interface EmailMessage {
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
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
  }>;
  flags: string[];
  headers?: Record<string, string>;
}

export interface ImapActionResult {
  success: boolean;
  operation: string;
  mailbox: string;
  messages: EmailMessage[];
  count: number;
  duration: number;
  timestamp: number;
}
