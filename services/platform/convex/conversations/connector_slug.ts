/**
 * Map conversation `connectorName` values (inbox filter / message rows) to
 * connector catalog slugs used by the credential store and dispatcher.
 */
export function conversationConnectorSlug(connectorName: string): string {
  if (connectorName === 'imap_smtp') return 'imap-smtp';
  return connectorName;
}

/** Connector slug and action name for the outbound email send path. */
export function sendConnectorAction(connectorName: string): {
  connector: string;
  action: string;
} {
  const connector = conversationConnectorSlug(connectorName);
  if (connector === 'imap-smtp') {
    return { connector, action: 'send' };
  }
  return { connector, action: 'send_message' };
}
