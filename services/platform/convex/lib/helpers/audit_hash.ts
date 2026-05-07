/**
 * Audit log hash chain utility.
 *
 * Computes SHA-256 integrity hashes for audit log entries to form a
 * tamper-evident chain. Each entry's hash covers the previous entry's
 * hash concatenated with the canonicalized record content.
 *
 * Hash computation:
 *   integrityHash = SHA-256(previousHash + canonicalize(record))
 *
 * where canonicalize(record) is a deterministic JSON string of all
 * fields except `integrityHash` and `previousHash`, with keys sorted
 * alphabetically at every nesting level.
 */

/**
 * Fields excluded from hash computation because they are part of the
 * hash chain metadata itself (or post-write annotations), not the
 * record payload that the writer signed.
 *
 * `chainSuccessor` is patched onto a row by its successor's insert, so
 * it cannot be in the writer's hash input. `piiScrubbedAt` is patched
 * by the scrub pipeline and similarly post-dates the original signature.
 * Including either in the verifier's hash input would diverge from the
 * writer and report every patched row as tampered.
 */
const EXCLUDED_FIELDS = new Set([
  'integrityHash',
  'previousHash',
  'chainSuccessor',
  'piiScrubbedAt',
]);

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Produce a deterministic JSON string of `value` with object keys
 * sorted alphabetically at every level of nesting.
 */
function canonicalize(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }

  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalize(item)).join(',') + ']';
  }

  if (isRecord(value)) {
    const sortedKeys = Object.keys(value).sort();
    const entries = sortedKeys
      .filter((key) => !EXCLUDED_FIELDS.has(key))
      .map((key) => JSON.stringify(key) + ':' + canonicalize(value[key]));
    return '{' + entries.join(',') + '}';
  }

  return JSON.stringify(value);
}

/**
 * Compute the SHA-256 integrity hash for an audit log record.
 *
 * @param previousHash - The `integrityHash` of the preceding entry in
 *   the organization's chain, or an empty string for the first entry.
 * @param record - The audit log record fields (excluding `integrityHash`
 *   and `previousHash`).
 * @returns Hex-encoded SHA-256 hash string.
 */
export async function computeAuditHash(
  previousHash: string,
  record: Record<string, unknown>,
): Promise<string> {
  const canonical = canonicalize(record);
  // Concatenation: previousHash + canonical record content
  const input = previousHash + canonical;

  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export { canonicalize as canonicalizeForTest };
