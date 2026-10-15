/**
 * The arithmetic of one mailbox sync pass: which listed emails a pass reads,
 * in what order, and how far each folder's position may move afterwards.
 * No I/O — the sync (`sync_mailbox.ts`) lists, reads and stores; this decides.
 *
 * A position belongs to one mailbox and one folder (Inbox, Sent). It is an
 * instant on the PROVIDER's clock — when Gmail, Exchange or the IMAP server
 * took the email in — never the sender's Date header, which a wrong clock
 * sets days behind or years ahead. Its meaning: every email of the folder
 * that arrived at or before it has been read. A pass therefore reads strictly
 * after it, oldest first, and moves it only past what it read.
 */

import { z } from 'zod';

export type MailFolder = 'inbox' | 'sent';

/** The order folders are read in when two emails share an instant: what the
 * mailbox sent comes before the answer to it. */
const FOLDER_ORDER: Record<MailFolder, number> = { sent: 0, inbox: 1 };

/** One email a listing offered, before its body is read. */
export interface MailCandidate {
  folder: MailFolder;
  /** The provider's id for it — one email listed twice (a Gmail message
   * labelled both Inbox and Sent) is read once. */
  key: string;
  /** The listing row, which the read is asked with. */
  row: Record<string, unknown>;
  /** When the provider took it in, epoch ms; null until its body is read
   * (Gmail lists ids only). */
  at: number | null;
}

// ------------------------------------------------------- edges (Gmail)

/** The most ids an edge keeps: a second holding more email than this lists
 * the rest again, and they are passed over once their instants are read. */
export const MAX_EDGE_IDS = 1000;

/**
 * The emails already read at one folder's position, kept with it (`mail_sync_edges`,
 * 0214). Gmail's search reads whole seconds, so a pass lists the emails of
 * its position's own second again; the next pass leaves these ids out of the
 * listing instead of counting them as new. An edge counts only while `at`
 * equals the folder's position.
 */
const mailEdgeSchema = z
  .object({
    at: z.number().int().nonnegative(),
    ids: z.array(z.string().min(1).max(200)).max(MAX_EDGE_IDS),
  })
  .strict();

/** A credential's edges, one per folder. */
export const mailSyncEdgesSchema = z
  .object({ inbox: mailEdgeSchema.optional(), sent: mailEdgeSchema.optional() })
  .strict();

export type MailEdge = z.infer<typeof mailEdgeSchema>;
export type MailEdges = z.infer<typeof mailSyncEdgesSchema>;

/** A stored edges value, or none when it is not one the sync wrote. */
export function readEdges(stored: unknown): MailEdges {
  const parsed = mailSyncEdgesSchema.safeParse(stored);
  return parsed.success ? parsed.data : {};
}

/** The ids of a folder's edge, when the edge belongs to its position. */
export function edgeIds(
  edge: MailEdge | undefined,
  position: number | null,
): ReadonlySet<string> {
  return edge !== undefined && position !== null && edge.at === position
    ? new Set(edge.ids)
    : new Set();
}

/**
 * A folder's edge after a pass: the emails read in the second its position
 * falls in, up to the position — the ones this pass read with their
 * instants, and, while the position stays in the same second, the ones the
 * edge held before.
 */
export function edgeAt(
  position: number,
  args: {
    previousPosition: number | null;
    previous: ReadonlySet<string>;
    read: readonly MailCandidate[];
  },
): MailEdge {
  const second = Math.floor(position / 1000);
  const ids = new Set<string>();
  if (
    args.previousPosition !== null &&
    Math.floor(args.previousPosition / 1000) === second
  ) {
    for (const id of args.previous) ids.add(id);
  }
  for (const candidate of args.read) {
    if (
      candidate.at !== null &&
      candidate.at <= position &&
      Math.floor(candidate.at / 1000) === second
    ) {
      ids.add(candidate.key);
    }
  }
  return { at: position, ids: [...ids].slice(0, MAX_EDGE_IDS) };
}

/** Whether two edges say the same. */
export function sameEdge(a: MailEdge | undefined, b: MailEdge): boolean {
  if (a === undefined || a.at !== b.at || a.ids.length !== b.ids.length) {
    return false;
  }
  const held = new Set(a.ids);
  return b.ids.every((id) => held.has(id));
}

/** A position written longer ago than this ahead of the server's clock was
 * not taken from a provider's clock: older syncs read the sender's Date
 * header, and one dated years ahead stranded every later email. */
const FUTURE_POSITION_TOLERANCE_MS = 3_600_000;

/** A stored position, or null when there is none to continue from. */
export function usablePosition(
  stored: number | null | undefined,
  now: number,
): number | null {
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return null;
  return stored > now + FUTURE_POSITION_TOLERANCE_MS ? null : stored;
}

/** Oldest first; on a tie, Sent before Inbox, then the provider's order. */
export function byArrival(
  candidates: readonly MailCandidate[],
): MailCandidate[] {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (a, b) =>
        (a.candidate.at ?? 0) - (b.candidate.at ?? 0) ||
        FOLDER_ORDER[a.candidate.folder] - FOLDER_ORDER[b.candidate.folder] ||
        a.index - b.index,
    )
    .map(({ candidate }) => candidate);
}

/** One email per provider id, the first listing that offered it kept. */
export function distinctCandidates(
  candidates: readonly MailCandidate[],
): MailCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.key)) return false;
    seen.add(candidate.key);
    return true;
  });
}

/** What one pass over timed listings reads. */
export interface TimedPassPlan {
  /** In the order they are read and stored. */
  take: MailCandidate[];
  /** More was listed than this pass reads. */
  capped: boolean;
  /** Set when the oldest instant alone holds more email than a pass reads:
   * that folder's instant must be listed and read whole. */
  widen?: { folder: MailFolder; at: number };
}

/**
 * The emails a pass reads from listings that carry each email's instant
 * (Outlook, IMAP): each folder lists one more than the pass reads, oldest
 * first, and the folders are read in one order, oldest first.
 *
 * A pass never stops inside an instant: when the email right after its last
 * one in a folder shares that instant, the pass leaves the whole instant of
 * that folder for the next one, whose listing starts strictly after the
 * position. Only an instant that alone holds more than a pass cannot be left,
 * and the plan says to read it whole.
 */
export function planTimedPass(
  listings: ReadonlyArray<{ folder: MailFolder; candidates: MailCandidate[] }>,
  cap: number,
): TimedPassPlan {
  const merged = byArrival(listings.flatMap((listing) => listing.candidates));
  let take = merged.slice(0, Math.max(0, cap));
  for (const { folder } of listings) {
    const next = merged.find(
      (candidate) => candidate.folder === folder && !take.includes(candidate),
    );
    if (next === undefined || next.at === null) continue;
    const boundary = next.at;
    take = take.filter(
      (candidate) =>
        candidate.folder !== folder ||
        candidate.at === null ||
        candidate.at < boundary,
    );
  }
  const first = merged[0];
  if (take.length === 0 && first !== undefined && first.at !== null) {
    return {
      take: [],
      capped: true,
      widen: { folder: first.folder, at: first.at },
    };
  }
  return { take, capped: merged.length > take.length };
}

/**
 * Where a folder's position stands after a pass: the newest instant at which
 * every listed email of the folder up to and including it was handled — read
 * and stored, already stored, unstorable, or gone. An email the pass did not
 * handle, or whose instant it never learned, holds the position before it.
 * Null when the position does not move.
 */
export function advancedPosition(
  candidates: readonly MailCandidate[],
  handled: ReadonlySet<string>,
): number | null {
  let firstOpen = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (handled.has(candidate.key)) continue;
    if (candidate.at === null) return null;
    firstOpen = Math.min(firstOpen, candidate.at);
  }
  let position: number | null = null;
  for (const candidate of candidates) {
    if (!handled.has(candidate.key) || candidate.at === null) continue;
    if (candidate.at >= firstOpen) continue;
    position =
      position === null ? candidate.at : Math.max(position, candidate.at);
  }
  return position;
}

/** One probe of a window: what it listed, and whether it held more than one
 * pass reads. */
export interface WindowProbe<T> {
  rows: T[];
  overflow: boolean;
}

/** The window a pass reads whole, or the second it cannot split. */
export type FittingWindow<T> =
  | { rows: T[]; beforeSec: number | null; narrowed: boolean }
  | { overflowAt: number };

/**
 * The widest window from `fromSec` that one pass reads whole, for a provider
 * that lists ids without their instants, newest first (Gmail): the open
 * window first; when it holds more than a pass, a binary search on the
 * window's end, in whole seconds, for a later end whose window still fits.
 * The search stops early once a fitting window holds `enough`.
 *
 * Reading a window whole is what makes the position exact whatever order the
 * provider lists in: every email of the window is read, so none before the
 * newest one read is left behind. When even one second holds more than a pass
 * (or the probes run out first), the answer names the end that overflowed.
 */
export async function fittingWindow<T>(args: {
  fromSec: number;
  nowSec: number;
  probe: (beforeSec: number | null) => Promise<WindowProbe<T>>;
  maxProbes: number;
  enough: number;
}): Promise<FittingWindow<T>> {
  const open = await args.probe(null);
  if (!open.overflow) {
    return { rows: open.rows, beforeSec: null, narrowed: false };
  }
  let fits = args.fromSec + 1;
  let overflows = Math.max(args.nowSec + 1, fits + 1);
  let fit: T[] | null = null;
  for (
    let probes = 0;
    probes < args.maxProbes && overflows - fits > 1;
    probes++
  ) {
    const end = fits + Math.floor((overflows - fits) / 2);
    const window = await args.probe(end);
    if (window.overflow) {
      overflows = end;
      continue;
    }
    fits = end;
    fit = window.rows;
    if (fit.length >= args.enough) break;
  }
  if (fit !== null && fit.length > 0) {
    return { rows: fit, beforeSec: fits, narrowed: true };
  }
  return { overflowAt: overflows };
}
