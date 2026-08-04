/**
 * The agent-turn transcript timeline — ONE merge discipline for every holder
 * of it.
 *
 * A turn's drain windows each rebuild their projection from scratch (fresh
 * parser over the exec's 256 KB ring buffer), so any single flush is a
 * bounded, possibly much shorter view of the turn: entries routinely vanish
 * from its head, and a fresh window can open with almost nothing. Every
 * holder of a transcript therefore MERGES flushes instead of replacing —
 * the op row in Convex (`upsertSessionOp`) and the run views' client
 * accumulator both fold each flush in through this module, so neither ever
 * loses an entry it already held.
 *
 * The merge only ever updates or appends: a tool entry is identified by its
 * `toolCallId` and updated in place as it moves input→output; a text block
 * has no id, so it is keyed to the tool entry it follows (a projection emits
 * at most one text block per gap). A text block whose anchor tool was
 * trimmed away re-arrives keyed to the start — appending it would repeat
 * prose the reader already has, so a suffix-overlap with any kept text
 * swallows it instead.
 */

/** One entry of a turn's live transcript, in the AI-SDK UI-part shape the
 * run views render (`sessionOpTimelinePartValidator` is its runtime twin). */
export interface TimelinePart {
  type: string;
  text?: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

/** A merged transcript entry: the part plus the identity the merge tracks
 * it under across flushes. */
export interface TimelineEntry {
  key: string;
  part: TimelinePart;
}

/** Entries a stored transcript keeps, newest wins. Sized for a long
 * tool-heavy turn to stay readable end to end. */
export const TIMELINE_MAX_ENTRIES = 400;
/** Byte budget of a stored transcript (serialized). Keeps the op row well
 * under Convex's 1 MB document cap next to `progressText`, and — being
 * larger than the exec's 256 KB ring buffer — guarantees a replay can never
 * re-deliver an entry old enough to have been evicted (which would re-append
 * it out of order). */
const TIMELINE_MAX_JSON_BYTES = 600_000;

const encoder = new TextEncoder();

/** The projection tail-slices a long text block behind a leading ellipsis;
 * strip it so overlap checks compare the words, not the marker. */
export function strippedText(part: TimelinePart): string {
  return (part.text ?? '').replace(/^…/, '');
}

function timelinePartsEqual(a: TimelinePart, b: TimelinePart): boolean {
  return (
    a.text === b.text &&
    a.state === b.state &&
    a.errorText === b.errorText &&
    JSON.stringify(a.input) === JSON.stringify(b.input) &&
    JSON.stringify(a.output) === JSON.stringify(b.output)
  );
}

function isToolPart(part: TimelinePart): boolean {
  return part.toolCallId !== undefined && part.toolCallId !== '';
}

/**
 * Fold one flush into the transcript accumulated so far. Returns `acc`
 * unchanged (same identity) when the flush brought nothing new, so state
 * holders can skip a no-op write.
 */
export function mergeTimelineEntries(
  acc: readonly TimelineEntry[],
  incoming: readonly TimelinePart[],
): readonly TimelineEntry[] {
  const indexByKey = new Map(acc.map((entry, index) => [entry.key, index]));
  let next: TimelineEntry[] | null = null;
  let anchor = '^';
  for (const part of incoming) {
    const isTool = isToolPart(part);
    const key = isTool ? `tool:${String(part.toolCallId)}` : `text:${anchor}`;
    if (isTool) anchor = String(part.toolCallId);
    const at = indexByKey.get(key);
    if (at !== undefined) {
      const kept = (next ?? acc)[at];
      if (kept !== undefined && !timelinePartsEqual(kept.part, part)) {
        next ??= [...acc];
        next[at] = { key, part };
      }
      continue;
    }
    if (!isTool && anchor === '^') {
      const words = strippedText(part);
      const repeated =
        words !== '' &&
        (next ?? acc).some(
          (entry) =>
            entry.part.toolCallId === undefined &&
            strippedText(entry.part).endsWith(words),
        );
      if (repeated) continue;
    }
    next ??= [...acc];
    indexByKey.set(key, next.length);
    next.push({ key, part });
  }
  return next ?? acc;
}

/**
 * Re-key a STORED transcript so a merge can resume against it. Keys derive
 * from the same anchor walk as the merge, with one extra duty: eviction can
 * leave two text blocks adjacent under one computed key (their separating
 * tool is gone), and folding them together would eat a row the reader saw —
 * a collision takes a positional suffix instead, which no incoming key ever
 * matches, so the older row simply stays as it was.
 */
export function entriesFromStoredParts(
  parts: readonly TimelinePart[],
): TimelineEntry[] {
  const taken = new Set<string>();
  const entries: TimelineEntry[] = [];
  let anchor = '^';
  for (const part of parts) {
    const isTool = isToolPart(part);
    const base = isTool ? `tool:${String(part.toolCallId)}` : `text:${anchor}`;
    if (isTool) anchor = String(part.toolCallId);
    let key = base;
    for (let n = 1; taken.has(key); n += 1) key = `${base}~${String(n)}`;
    taken.add(key);
    entries.push({ key, part });
  }
  return entries;
}

/**
 * Bound a transcript to its budgets, evicting the OLDEST entries first (the
 * newest are what a viewer is following). Never empties a non-empty list.
 */
export function boundTimelineParts(
  parts: readonly TimelinePart[],
  bounds: { maxEntries: number; maxJsonBytes: number } = {
    maxEntries: TIMELINE_MAX_ENTRIES,
    maxJsonBytes: TIMELINE_MAX_JSON_BYTES,
  },
): TimelinePart[] {
  const sizes = parts.map(
    (part) => encoder.encode(JSON.stringify(part)).length,
  );
  let bytes = sizes.reduce((sum, size) => sum + size, 0);
  let from = 0;
  while (
    from < parts.length - 1 &&
    (parts.length - from > bounds.maxEntries || bytes > bounds.maxJsonBytes)
  ) {
    bytes -= sizes[from] ?? 0;
    from += 1;
  }
  return parts.slice(from);
}

/**
 * The stored-transcript merge: fold one flush into a persisted parts array
 * and re-bound it. This is what keeps the op row's `liveTimeline` monotonic
 * across drain windows — a fresh window's short first flush lands as an
 * update, never as a wipe.
 */
export function mergeTimelineParts(
  existing: readonly TimelinePart[] | undefined,
  incoming: readonly TimelinePart[],
): TimelinePart[] {
  const merged = mergeTimelineEntries(
    entriesFromStoredParts(existing ?? []),
    incoming,
  );
  return boundTimelineParts(merged.map((entry) => entry.part));
}
