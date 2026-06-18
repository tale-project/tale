import { describe, expect, it } from 'vitest';

import { RingBuffer } from './ring-buffer.ts';

describe('RingBuffer', () => {
  it('retains items up to capacity in order', () => {
    const r = new RingBuffer<number>(3);
    r.push(1);
    r.push(2);
    expect(r.toArray()).toEqual([1, 2]);
    expect(r.size).toBe(2);
  });

  it('overwrites the oldest item past capacity', () => {
    const r = new RingBuffer<number>(3);
    for (const n of [1, 2, 3, 4, 5]) r.push(n);
    expect(r.toArray()).toEqual([3, 4, 5]);
    expect(r.size).toBe(3);
  });

  it('tail returns the most recent n, oldest-first', () => {
    const r = new RingBuffer<string>(5);
    for (const s of ['a', 'b', 'c', 'd']) r.push(s);
    expect(r.tail(2)).toEqual(['c', 'd']);
    expect(r.tail(10)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a capacity-1 buffer keeps only the latest item', () => {
    const r = new RingBuffer<number>(1);
    r.push(1);
    r.push(2);
    r.push(3);
    expect(r.toArray()).toEqual([3]);
    expect(r.size).toBe(1);
  });

  it('coerces a zero/negative capacity up to 1', () => {
    const r = new RingBuffer<number>(0);
    r.push(1);
    r.push(2);
    expect(r.toArray()).toEqual([2]);
  });

  it('tail(0) and an empty buffer return []', () => {
    const r = new RingBuffer<number>(3);
    expect(r.toArray()).toEqual([]);
    expect(r.tail(0)).toEqual([]);
    r.push(1);
    expect(r.tail(0)).toEqual([]);
  });

  it('preserves a legitimately-stored undefined (no value dropped)', () => {
    const r = new RingBuffer<number | undefined>(3);
    r.push(1);
    r.push(undefined);
    r.push(3);
    expect(r.toArray()).toEqual([1, undefined, 3]);
    expect(r.size).toBe(3);
    expect(r.tail(2)).toEqual([undefined, 3]);
  });

  it('keeps order correct after the head wraps past capacity', () => {
    const r = new RingBuffer<number>(3);
    for (const n of [1, 2, 3, 4]) r.push(n); // head wrapped once
    expect(r.toArray()).toEqual([2, 3, 4]);
    expect(r.tail(2)).toEqual([3, 4]);
  });
});
