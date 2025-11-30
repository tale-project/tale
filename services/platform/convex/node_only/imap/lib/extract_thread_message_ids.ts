/**
 * Extract message IDs from threading headers In-Reply-To and References.
 *
 * This function parses standard RFC 5322 email threading headers to build
 * a thread graph. It works with both Gmail and Outlook.
 *
 * @param headers - Email headers object
 * @returns Array of unique Message-IDs found in In-Reply-To and References headers
 */
export default function extractThreadMessageIds(
  headers: Record<string, string> | undefined,
): string[] {
  if (!headers) return [];

  const messageIds: string[] = [];

  // Extract In-Reply-To header (immediate parent message)
  const inReplyTo = headers['in-reply-to'];
  if (inReplyTo) {
    const trimmed = inReplyTo.trim();
    messageIds.push(trimmed);
    console.log(`[IMAP Thread] Found In-Reply-To: ${trimmed}`);
  }

  // Extract References header (full thread ancestry)
  const references = headers['references'];
  if (references) {
    const refIds = references
      .split(/,\s*|\s+/)
      .map((id) => id.trim())
      .filter((id) => id.length > 0 && id !== ',');
    messageIds.push(...refIds);
    console.log(
      `[IMAP Thread] Found ${refIds.length} Reference(s): ${refIds.join(', ')}`,
    );
  }

  const uniqueIds = Array.from(new Set(messageIds));
  console.log(
    `[IMAP Thread] Extracted ${uniqueIds.length} unique Message-ID(s) from headers`,
  );

  return uniqueIds;
}
