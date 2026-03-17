/**
 * Normalize raw email provider API responses (e.g. Gmail) into EmailType.
 *
 * Connectors may return either:
 * 1. Already-mapped EmailType objects (when format=email or connector does mapping)
 * 2. Raw API responses (e.g. Gmail API full-format messages)
 *
 * This helper detects the format and normalizes to EmailType so downstream
 * code works regardless of connector version.
 */
import type { EmailType } from './types';

interface RawGmailHeader {
  name: string;
  value: string;
}

interface RawGmailPayloadPart {
  mimeType?: string;
  filename?: string;
  headers?: RawGmailHeader[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: RawGmailPayloadPart[];
}

interface RawGmailMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: RawGmailPayloadPart & { headers?: RawGmailHeader[] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRawGmailMessage(data: unknown): data is RawGmailMessage {
  if (!isRecord(data)) return false;
  if (!('payload' in data) || !isRecord(data.payload)) return false;
  return (
    'headers' in data.payload &&
    Array.isArray(data.payload.headers) &&
    !('from' in data && Array.isArray(data.from))
  );
}

function getHeader(
  headers: RawGmailHeader[] | undefined,
  name: string,
): string {
  if (!headers) return '';
  const lower = name.toLowerCase();
  for (const h of headers) {
    if (h.name.toLowerCase() === lower) return h.value || '';
  }
  return '';
}

function parseAddress(str: string): { name: string; address: string } {
  if (!str) return { name: '', address: '' };
  const match = str.match(/^(.*?)\s*<(.+?)>$/);
  if (match) {
    return { name: match[1].trim().replace(/^"|"$/g, ''), address: match[2] };
  }
  return { name: '', address: str.trim() };
}

function parseAddressList(
  str: string,
): Array<{ name: string; address: string }> {
  if (!str) return [];
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of str) {
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.map(parseAddress);
}

function extractBody(
  payload: RawGmailPayloadPart | undefined,
  mimeType: string,
): string {
  if (!payload) return '';
  if (payload.mimeType === mimeType && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const result = extractBody(part, mimeType);
      if (result) return result;
    }
  }
  return '';
}

function decodeBase64Url(data: string): string {
  if (!data) return '';
  let base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';
  try {
    return atob(base64);
  } catch {
    return '';
  }
}

function findAttachmentParts(part: RawGmailPayloadPart): Array<{
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
}> {
  const result: Array<{
    id: string;
    filename: string;
    contentType: string;
    size: number;
    contentId?: string;
  }> = [];

  if (part.body?.attachmentId) {
    const cidHeader = getHeader(part.headers, 'Content-ID');
    const contentId = cidHeader ? cidHeader.replace(/^<|>$/g, '') : undefined;
    result.push({
      id: part.body.attachmentId,
      filename: part.filename || 'attachment',
      contentType: part.mimeType || 'application/octet-stream',
      size: part.body.size || 0,
      ...(contentId ? { contentId } : {}),
    });
  }
  if (part.parts) {
    for (const sub of part.parts) {
      result.push(...findAttachmentParts(sub));
    }
  }
  return result;
}

function gmailToEmailType(msg: RawGmailMessage): EmailType {
  const hdrs = msg.payload?.headers;
  const fromStr = getHeader(hdrs, 'From');
  const fromParsed = parseAddress(fromStr);

  const attachments = msg.payload ? findAttachmentParts(msg.payload) : [];

  return {
    uid: 0,
    messageId: msg.id || '',
    from: [fromParsed],
    to: parseAddressList(getHeader(hdrs, 'To')),
    cc: parseAddressList(getHeader(hdrs, 'Cc')),
    bcc: parseAddressList(getHeader(hdrs, 'Bcc')),
    subject: getHeader(hdrs, 'Subject') || '',
    date: getHeader(hdrs, 'Date') || msg.internalDate || '',
    text: extractBody(msg.payload, 'text/plain'),
    html: extractBody(msg.payload, 'text/html'),
    flags: msg.labelIds && !msg.labelIds.includes('UNREAD') ? ['\\Seen'] : [],
    headers: {
      'message-id': getHeader(hdrs, 'Message-ID') || '',
      'in-reply-to': getHeader(hdrs, 'In-Reply-To') || '',
      references: getHeader(hdrs, 'References') || '',
    },
    attachments,
    direction: undefined,
  };
}

/**
 * Normalize a single email object. If it's a raw Gmail API message,
 * converts it to EmailType. Otherwise returns as-is.
 */
export function normalizeEmail(data: unknown): EmailType {
  if (isRawGmailMessage(data)) {
    return gmailToEmailType(data);
  }
  // Already-mapped EmailType from connector (has `from` array, no `payload`).
  // We can't fully validate the shape at runtime, so we trust the connector contract.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return data as EmailType;
}

/**
 * Normalize an array of email objects or a single email object.
 */
export function normalizeEmails(data: unknown): EmailType[] {
  if (Array.isArray(data)) {
    return data.map(normalizeEmail);
  }
  return [normalizeEmail(data)];
}
