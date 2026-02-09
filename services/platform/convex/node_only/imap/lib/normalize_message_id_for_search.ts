// Normalize/expand Message-ID for IMAP HEADER search to try with and without angle brackets
export default function normalizeMessageIdForSearch(
  messageId: string,
): string[] {
  const variants: string[] = [];
  variants.push(messageId);
  if (messageId.startsWith('<') && messageId.endsWith('>')) {
    variants.push(messageId.slice(1, -1));
  } else {
    variants.push(`<${messageId}>`);
  }
  return variants;
}
