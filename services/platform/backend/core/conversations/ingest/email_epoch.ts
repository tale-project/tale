import { isEpochMs } from '@tale/shared/schemas/epoch-ms';

/**
 * Epoch ms for one email's `date`, read the way both the sync watermark and the
 * ingest helpers must agree on. Gmail hands back `internalDate` (epoch ms as a
 * STRING) when a message carries no `Date` header, which `new Date(...)` cannot
 * parse — hence the numeric fallback. Returns null when no instant is readable;
 * an instant `epochMsSchema` refuses (a pre-1970 header, a far-future
 * `internalDate`, a fraction of a millisecond) counts as unreadable, because
 * the ingest shim refuses a stamp outside that bound.
 */
export function emailEpochMs(date: unknown): number | null {
  const instant = readInstant(date);
  return isEpochMs(instant) ? instant : null;
}

function readInstant(date: unknown): number | null {
  if (typeof date === 'number') return date;
  if (typeof date !== 'string' || date.trim() === '') return null;
  const parsed = new Date(date).getTime();
  return Number.isFinite(parsed) ? parsed : Number(date);
}

/**
 * The instant stamps one message writer carries for an email — `sentAt`, plus
 * `deliveredAt` for a delivered message — or NEITHER when the message carries
 * no readable date. Absent, never NaN or out of range: the ingest shim holds
 * stamps to `epochMsSchema`, so such a stamp would reject the write and wedge
 * the whole mailbox pass behind that one message (the watermark never
 * advances past it). Without a stamp the row falls back to its own creation
 * time in the display order.
 */
export function emailStamps(
  date: unknown,
  delivered: boolean,
): { sentAt?: number; deliveredAt?: number } {
  const ms = emailEpochMs(date);
  if (ms === null) return {};
  return delivered ? { sentAt: ms, deliveredAt: ms } : { sentAt: ms };
}

/** Oldest-first order for an ingest batch (the root that anchors threading
 * lands first). An undated email sorts first rather than poisoning the
 * comparator with NaN. */
export function byEmailDateAscending(
  a: { date?: unknown },
  b: { date?: unknown },
): number {
  return (emailEpochMs(a.date) ?? 0) - (emailEpochMs(b.date) ?? 0);
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
