/**
 * Structural type for integration-like objects that may be IMAP/SMTP
 * integrations. Accepts both Doc<'integrationCredentials'> and
 * LoadedIntegration.
 */
interface IntegrationLike {
  type?: string;
}

/**
 * Narrowed type returned by the type guard.
 */
type NarrowedImapSmtpIntegration<T extends IntegrationLike> = T & {
  type: 'imap_smtp';
};

/**
 * Type guard to check if an integration is an IMAP/SMTP mailbox integration.
 *
 * IMAP and SMTP are raw-TCP protocols, so these integrations run as Node
 * actions (`convex/node_only/imap_smtp`) rather than in the HTTP-only
 * connector sandbox — mirroring the SQL integration path.
 *
 * Connection details (host/port/TLS) live in `connectionConfig`; credentials
 * live in `basicAuth`. There are no SQL-style dedicated config fields, so the
 * guard narrows purely on `type`.
 *
 * @example
 * if (isImapSmtpIntegration(integration)) {
 *   // integration.type is now 'imap_smtp'
 * }
 */
export function isImapSmtpIntegration<T extends IntegrationLike>(
  integration: T,
): integration is NarrowedImapSmtpIntegration<T> {
  return integration.type === 'imap_smtp';
}
