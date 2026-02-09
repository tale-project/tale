export interface ImapCredentials {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string; // For password-based auth
  accessToken?: string; // For OAuth2 auth
}

// Discriminated union type for IMAP operations
export type ImapActionParams = {
  operation: 'search';
  // Credentials (optional if provided in variables)
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  accessToken?: string;
  // Operation details
  mailbox?: string; // Default: 'INBOX'
  // Fetch parameters
  afterUid?: number; // Fetch 1 email after this UID (omit to fetch latest)
  // Options
  includeAttachments?: boolean; // Include attachment metadata
  parseHtml?: boolean; // Parse HTML content
  threadSearchFolders?: string[] | string; // Folders to search for thread messages - can be array or JSON string (default: ['INBOX', '[Gmail]/Sent Mail'])
};

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

// Actions should return data directly (not wrapped in { data: ... })
// because execute_action_node wraps the result in output: { type: 'action', data: result }
export type ImapActionResult = EmailMessage[];
