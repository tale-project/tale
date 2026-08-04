// The transcript merge discipline. A drain window's flush is a bounded,
// possibly near-empty rebuild of the turn (fresh parser over the exec's ring
// buffer), so every holder — the op row and the run views' accumulator —
// folds flushes in through these helpers. The invariant under test: a merge
// NEVER loses an entry its holder already had, no matter how short or stale
// the incoming flush is.

import { describe, expect, it } from 'vitest';

import {
  boundTimelineParts,
  entriesFromStoredParts,
  mergeTimelineEntries,
  mergeTimelineParts,
  TIMELINE_MAX_ENTRIES,
  type TimelinePart,
} from './timeline';

function tool(id: string, extra: Partial<TimelinePart> = {}): TimelinePart {
  return {
    type: `tool-Bash`,
    state: 'input-available',
    toolCallId: id,
    input: { command: `run ${id}` },
    ...extra,
  };
}

describe('mergeTimelineEntries', () => {
  it('updates a tool in place as it moves input→output', () => {
    const acc = mergeTimelineEntries([], [tool('t1')]);
    const next = mergeTimelineEntries(acc, [
      tool('t1', { state: 'output-available', output: 'ok' }),
    ]);
    expect(next).toHaveLength(1);
    expect(next[0]?.part.state).toBe('output-available');
    expect(next[0]?.key).toBe(acc[0]?.key);
  });

  it('never drops rows a shorter flush no longer carries', () => {
    const acc = mergeTimelineEntries(
      [],
      [{ type: 'text', text: 'first thought' }, tool('t1'), tool('t2')],
    );
    const next = mergeTimelineEntries(acc, [
      tool('t2', { state: 'output-available', output: 'done' }),
    ]);
    expect(next.map((entry) => entry.key)).toEqual(
      acc.map((entry) => entry.key),
    );
    expect(next[0]?.part.text).toBe('first thought');
  });

  it('swallows a re-arrived leading text the reader already has', () => {
    const acc = mergeTimelineEntries(
      [],
      [tool('t1'), { type: 'text', text: 'the plan is set' }],
    );
    // Next window: t1 fell off the flush head, the same words re-arrive
    // anchored to the start (tail-clamped behind an ellipsis).
    const next = mergeTimelineEntries(acc, [
      { type: 'text', text: '…plan is set' },
    ]);
    expect(next).toBe(acc);
  });

  it('returns the accumulator unchanged (same identity) on a no-op flush', () => {
    const acc = mergeTimelineEntries([], [tool('t1')]);
    expect(mergeTimelineEntries(acc, [tool('t1')])).toBe(acc);
  });
});

describe('entriesFromStoredParts', () => {
  it('keys adjacent texts distinctly so a re-seed cannot fold one into the other', () => {
    // Eviction can leave two prose blocks adjacent (their separating tool is
    // gone); both then compute the same anchor key. The seed disambiguates,
    // so a merge over it updates the first slot (streaming prose grows in
    // place) without ever swallowing the second row.
    const stored: TimelinePart[] = [
      { type: 'text', text: 'older prose' },
      { type: 'text', text: 'newer prose' },
    ];
    const entries = entriesFromStoredParts(stored);
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(2);
    const next = mergeTimelineEntries(entries, [
      { type: 'text', text: 'older prose, continued' },
    ]);
    expect(next.map((entry) => entry.part.text)).toEqual([
      'older prose, continued',
      'newer prose',
    ]);
  });
});

describe('boundTimelineParts', () => {
  it('keeps the NEWEST entries when the count budget overflows', () => {
    const parts = Array.from({ length: TIMELINE_MAX_ENTRIES + 50 }, (_, i) =>
      tool(`t${String(i)}`),
    );
    const bounded = boundTimelineParts(parts);
    expect(bounded).toHaveLength(TIMELINE_MAX_ENTRIES);
    expect(bounded.at(-1)?.toolCallId).toBe(
      `t${String(TIMELINE_MAX_ENTRIES + 49)}`,
    );
    expect(bounded[0]?.toolCallId).toBe('t50');
  });

  it('evicts oldest entries until the byte budget holds', () => {
    const fat = (id: string) => tool(id, { output: 'x'.repeat(1_000) });
    const parts = [fat('t1'), fat('t2'), fat('t3'), fat('t4')];
    const bounded = boundTimelineParts(parts, {
      maxEntries: 400,
      maxJsonBytes: 2_500,
    });
    expect(bounded.map((part) => part.toolCallId)).toEqual(['t3', 't4']);
  });

  it('never empties a non-empty transcript, even past the byte budget', () => {
    const bounded = boundTimelineParts(
      [tool('t1', { output: 'x'.repeat(1_000) })],
      { maxEntries: 400, maxJsonBytes: 10 },
    );
    expect(bounded).toHaveLength(1);
  });
});

describe('mergeTimelineParts', () => {
  it('folds a near-empty fresh-window flush into the stored transcript instead of wiping it', () => {
    // The bug this module exists for: a new drain window replays only what
    // the ring buffer still holds — after a huge payload flushed it, that is
    // one or two entries. Assignment wiped the row down to them.
    const stored = mergeTimelineParts(undefined, [
      { type: 'text', text: 'working through the slides' },
      tool('t1', { state: 'output-available', output: 'ok' }),
      tool('t2', { state: 'output-available', output: 'ok' }),
    ]);
    const next = mergeTimelineParts(stored, [tool('t3')]);
    expect(next.map((part) => part.toolCallId ?? 'text')).toEqual([
      'text',
      't1',
      't2',
      't3',
    ]);
  });

  it('updates a stored tool in place from a replayed flush', () => {
    const stored = mergeTimelineParts(undefined, [tool('t1')]);
    const next = mergeTimelineParts(stored, [
      tool('t1', { state: 'output-error', errorText: 'boom' }),
    ]);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ state: 'output-error', errorText: 'boom' });
  });

  it('starts from the flush alone when nothing is stored yet', () => {
    expect(mergeTimelineParts(undefined, [tool('t1')])).toHaveLength(1);
  });
});
