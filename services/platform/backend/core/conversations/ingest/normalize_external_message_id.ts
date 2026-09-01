/**
 * Canonical Message-ID form for store and lookup.
 * IMAP stores IDs without angle brackets; headers often include them.
 */
export function normalizeExternalMessageId(
  id: string | undefined | null,
): string | undefined {
  if (!id) return undefined;
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^<|>$/g, '');
}
