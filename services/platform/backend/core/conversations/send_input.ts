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
    return {
      to: recipients,
      subject: args.subject,
      ...(html ? { html: args.body } : { text: args.body }),
      ...(args.inReplyTo !== undefined && { inReplyTo: args.inReplyTo }),
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

export function internetMessageIdFromSendOutput(
  output: unknown,
): string | undefined {
  if (!isRecord(output)) return undefined;
  if (typeof output.messageId === 'string' && output.messageId.includes('@')) {
    return output.messageId;
  }
  return undefined;
}
