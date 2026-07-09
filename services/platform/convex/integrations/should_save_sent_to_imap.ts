/**
 * Whether outbound SMTP sends should also be APPENDed to the IMAP Sent folder.
 * Default: on whenever IMAP is configured (split relay + mailbox or same host).
 */

export function shouldSaveSentToImap(
  connectionConfig: Record<string, unknown> | undefined,
): boolean {
  const raw = connectionConfig?.saveSentToImap;
  if (raw === false || raw === 'false') {
    return false;
  }
  return true;
}
