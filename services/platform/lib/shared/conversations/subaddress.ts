/**
 * Plus-addressing (subaddresses): `support+billing@acme.test` is delivered to
 * the `support@acme.test` mailbox, with `billing` as a tag the sender chose.
 * Routing lets a rule for the base address catch every tag, while a rule
 * written for one tagged address still wins for that address.
 */

/** Trimmed and lowercased, the form routing compares addresses in. */
export function normalizedAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * The address with its tag removed: the local part up to the first `+`.
 * `undefined` for something that is not `local@domain`, or whose local part
 * starts with `+` (there is no base to fall back to).
 */
export function baseAddress(address: string): string | undefined {
  const normalized = normalizedAddress(address);
  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at === normalized.length - 1) return undefined;
  const local = normalized.slice(0, at);
  const plus = local.indexOf('+');
  if (plus === 0) return undefined;
  return `${plus === -1 ? local : local.slice(0, plus)}${normalized.slice(at)}`;
}
