import { describe, expect, it } from 'vitest';

import {
  applyJobProgressOps,
  OP_ID_RING_BUFFER_SIZE,
  trimOpIdRing,
  type JobProgressItem,
} from './progress_ops';

const NOW = 1_000_000;

function item(
  id: string,
  status: JobProgressItem['status'] = 'pending',
  createdAt = NOW - 100,
): JobProgressItem {
  return {
    id,
    content: `item ${id}`,
    status,
    createdAt,
    updatedAt: createdAt,
  };
}

describe('applyJobProgressOps', () => {
  it('rejects an empty batch', () => {
    const result = applyJobProgressOps([], [], NOW);
    expect(result).toMatchObject({ success: false, code: 'invalid_batch' });
  });

  it('adds items as pending and derives no active id', () => {
    const result = applyJobProgressOps(
      [],
      [
        { type: 'add', id: 'q1', content: 'first' },
        { type: 'add', id: 'q2', content: 'second' },
      ],
      NOW,
    );
    expect(result).toMatchObject({ success: true });
    if (!result.success) return;
    expect(result.progress.map((p) => p.id)).toEqual(['q1', 'q2']);
    expect(result.activeProgressId).toBeUndefined();
  });

  it('rejects duplicate adds', () => {
    const result = applyJobProgressOps(
      [item('q1')],
      [{ type: 'add', id: 'q1', content: 'again' }],
      NOW,
    );
    expect(result).toMatchObject({ success: false, code: 'duplicate_add' });
  });

  it('rejects updates to unknown items', () => {
    const result = applyJobProgressOps(
      [],
      [{ type: 'update', id: 'ghost', status: 'done' }],
      NOW,
    );
    expect(result).toMatchObject({ success: false, code: 'unknown_item' });
  });

  it('updates status/note and derives the active item', () => {
    const result = applyJobProgressOps(
      [item('q1'), item('q2')],
      [
        { type: 'update', id: 'q1', status: 'done', note: 'found it' },
        { type: 'update', id: 'q2', status: 'in_progress' },
      ],
      NOW,
    );
    expect(result).toMatchObject({ success: true, activeProgressId: 'q2' });
    if (!result.success) return;
    expect(result.progress[0]).toMatchObject({
      id: 'q1',
      status: 'done',
      note: 'found it',
      updatedAt: NOW,
    });
  });

  it('removes items and keeps creation order', () => {
    const result = applyJobProgressOps(
      [item('q1', 'pending', NOW - 300), item('q2', 'pending', NOW - 200)],
      [
        { type: 'remove', id: 'q1' },
        { type: 'add', id: 'q3', content: 'third' },
      ],
      NOW,
    );
    if (!result.success) throw new Error('expected success');
    expect(result.progress.map((p) => p.id)).toEqual(['q2', 'q3']);
  });
});

describe('trimOpIdRing', () => {
  it('appends and dedupes the incoming opId', () => {
    expect(trimOpIdRing(['a', 'b'], 'a')).toEqual(['b', 'a']);
  });

  it('caps the ring at the buffer size', () => {
    const full = Array.from(
      { length: OP_ID_RING_BUFFER_SIZE },
      (_, i) => `op${i}`,
    );
    const next = trimOpIdRing(full, 'fresh');
    expect(next).toHaveLength(OP_ID_RING_BUFFER_SIZE);
    expect(next[next.length - 1]).toBe('fresh');
    expect(next).not.toContain('op0');
  });
});
