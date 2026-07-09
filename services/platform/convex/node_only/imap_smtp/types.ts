/**
 * Type definitions for the IMAP/SMTP mailbox integration.
 *
 * IMAP and SMTP are raw-TCP protocols, so this integration runs as a Node
 * action (`'use node'`) outside the HTTP-only connector sandbox — mirroring the
 * SQL integration under `convex/node_only/sql`.
 */

import type { EmailType } from '../../workflow_engine/action_defs/conversation/helpers/types';

export interface ImapCredentials {
  host: string;
  port: number;
  /** true → implicit TLS (port 993). false → STARTTLS / plain (port 143). */
  secure: boolean;
  user: string;
  password: string;
}

export interface SmtpCredentials {
  host: string;
  port: number;
  /** true → implicit TLS (port 465). false → STARTTLS / plain (ports 587/25). */
  secure: boolean;
  user: string;
  password: string;
}

export interface FetchMessagesParams {
  imap: ImapCredentials;
  /** Mailbox to read. Defaults to 'INBOX'. */
  mailbox?: string;
  /** When true, resolve the Sent folder via SPECIAL-USE / discovery; skip if missing. */
  sentFolder?: boolean;
  /** Only fetch messages received on/after this epoch-ms cursor. */
  since?: number;
  /** Cap on messages returned in a single sync. Defaults to 25. */
  maxResults?: number;
  /** Socket connect timeout in ms. Defaults to 15000. */
  connectTimeoutMs?: number;
}

export interface FetchMessagesResult {
  success: boolean;
  data?: EmailType[];
  error?: string;
  /** Non-fatal notice (e.g. Sent folder missing — sync skipped). */
  warning?: string;
  duration?: number;
}

export interface SendAttachment {
  filename: string;
  contentType: string;
  /** Convex storage URL the SMTP action streams the bytes from. */
  url: string;
}

export interface SendMessageParams {
  smtp: SmtpCredentials;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: SendAttachment[];
}

export interface SendMessageResult {
  success: boolean;
  /** RFC 2822 Message-ID assigned by the SMTP server / nodemailer. */
  messageId?: string;
  error?: string;
}

export interface AppendSentMessageParams {
  imap: ImapCredentials;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  /** Same Message-ID as the SMTP send for dedup when syncing Sent. */
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: SendAttachment[];
  /** Preferred Sent folder name from integration connectionConfig.sentMailbox. */
  sentMailbox?: string;
  connectTimeoutMs?: number;
}

export interface AppendSentMessageResult {
  success: boolean;
  /** Resolved IMAP path when append succeeded. */
  mailboxPath?: string;
  error?: string;
}

export interface TestConnectionParams {
  imap: ImapCredentials;
  /** Optional: when present, the SMTP transport is verified too. */
  smtp?: SmtpCredentials;
}

export interface TestConnectionResult {
  success: boolean;
  error?: string;
}
