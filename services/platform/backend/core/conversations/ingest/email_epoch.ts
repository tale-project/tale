/**
 * Epoch ms for one email's `date`, read the way both the sync watermark and the
 * ingest helpers must agree on. Gmail hands back `internalDate` (epoch ms as a
 * STRING) when a message carries no `Date` header, which `new Date(...)` cannot
 * parse — hence the numeric fallback. Returns null when no instant is readable.
 */
export function emailEpochMs(date: unknown): number | null {
  if (typeof date === 'number') {
    return Number.isFinite(date) ? date : null;
  }
  if (typeof date !== 'string' || date.trim() === '') return null;
  const parsed = new Date(date).getTime();
  if (Number.isFinite(parsed)) return parsed;
  const epoch = Number(date);
  return Number.isFinite(epoch) ? epoch : null;
}

/**
 * The newest instant among a set of emails — the tip the sync watermark may
 * advance to. `null` when none of them carry a readable date.
 */
export function tipOfEmails(
  emails: Iterable<{ date?: unknown }>,
): number | null {
  let tip: number | null = null;
  for (const email of emails) {
    const ms = emailEpochMs(email.date);
    if (ms === null) continue;
    tip = tip === null ? ms : Math.max(tip, ms);
  }
  return tip;
}
