/**
 * Pure send-lane helpers shared by the outbound send action
 * (`internal_actions.sendMessageViaConnectorAction`) and the 0.5 backend's
 * send job: shape the connector `send`/`send_message` input per provider and
 * read the provider's Message-ID back out of the send output.
 */

import { isRecord } from '../../../lib/utils/type-utils';
import { sendConnectorAction } from './connector_slug';
import { normalizeExternalMessageId } from './ingest/normalize_external_message_id';

export function isHtmlContentType(contentType: string | undefined): boolean {
  const normalized = (contentType ?? 'HTML').toLowerCase();
  return normalized.includes('html');
}

export function joinRecipients(addresses: readonly string[]): string {
  return addresses
    .map((address) => address.trim())
    .filter((address) => address !== '')
    .join(', ');
}

export function buildSendInput(args: {
  connectorName: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  contentType?: string;
  inReplyTo?: string;
  references?: string[];
  /** The address to send as (the Inbox's chosen alias or the address the
   * customer wrote to). Forwarded to imap-smtp only — its native resolves it
   * against the mailbox's configured From; gmail and outlook declare no From
   * input (the connected account sends as itself), so it is dropped there. */
  from?: string;
  attachments: Array<{
    name: string;
    contentType: string;
    size: number;
    url: string;
  }>;
}): Record<string, unknown> {
  const html = isHtmlContentType(args.contentType);
  const { connector } = sendConnectorAction(args.connectorName);
  const recipients = joinRecipients(args.to);

  if (connector === 'imap-smtp') {
    // The imap-smtp native carries the same fidelity as the API-mail send
    // paths now: cc, the References chain, and attachments (streamed from their
    // presigned URLs) — a reply must send everything the sender attached/cc'd.
    return {
      to: recipients,
      ...(args.cc && args.cc.length > 0 && { cc: joinRecipients(args.cc) }),
      subject: args.subject,
      ...(html ? { html: args.body } : { text: args.body }),
      ...(args.inReplyTo !== undefined && { inReplyTo: args.inReplyTo }),
      ...(args.references &&
        args.references.length > 0 && { references: args.references }),
      ...(args.from !== undefined && args.from !== '' && { from: args.from }),
      ...(args.attachments.length > 0 && {
        attachments: args.attachments.map((att) => ({
          name: att.name,
          contentType: att.contentType,
          size: att.size,
          url: att.url,
        })),
      }),
    };
  }

  const base: Record<string, unknown> = {
    to: connector === 'outlook' ? args.to : recipients,
    subject: args.subject,
    body: args.body,
    contentType: args.contentType ?? 'HTML',
  };
  if (args.cc && args.cc.length > 0) {
    base.cc = connector === 'outlook' ? args.cc : joinRecipients(args.cc);
  }
  if (args.inReplyTo) base.inReplyTo = args.inReplyTo;
  if (args.references && args.references.length > 0) {
    base.references =
      connector === 'outlook' ? args.references : args.references.join(' ');
  }
  if (args.attachments.length > 0) {
    base.attachments = args.attachments;
  }
  return base;
}

export function externalIdFromSendOutput(
  connectorName: string,
  output: unknown,
): string | undefined {
  if (!isRecord(output)) return undefined;
  const { connector } = sendConnectorAction(connectorName);
  if (connector === 'gmail' && typeof output.id === 'string') {
    return output.id;
  }
  if (typeof output.messageId === 'string') {
    return normalizeExternalMessageId(output.messageId) ?? output.messageId;
  }
  return undefined;
}
