import { describe, expect, it } from 'vitest';

import {
  appendHarnessAnswer,
  HARNESS_RECORD_MAX_CHARS,
  LineReassembler,
} from './jsonl';

describe('harness line bounds', () => {
  it('preserves authoritative answers beyond display bounds and rejects excess explicitly', () => {
    const answer = `START ${'x'.repeat(140_000)} END`;
    expect(
      appendHarnessAnswer(answer.slice(0, 50_000), answer.slice(50_000)),
    ).toBe(answer);
    expect(() =>
      appendHarnessAnswer('x'.repeat(HARNESS_RECORD_MAX_CHARS), '!'),
    ).toThrow('final answer exceeds');
  });
  it('reassembles fragmented lines and permits many short records in one chunk', () => {
    const lines = new LineReassembler(5);
    expect(lines.push('ab')).toEqual([]);
    expect(lines.push('c\n12345\nx\ny\n')).toEqual(['abc', '12345', 'x', 'y']);
    expect(lines.push('end')).toEqual([]);
    expect(lines.flush()).toEqual(['end']);
  });
  it('refuses oversized complete and unterminated records without retaining their bytes', () => {
    const lines = new LineReassembler(5);
    lines.push('123');
    expect(() => lines.push('456')).toThrow('protocol record exceeds');
    expect(lines.flush()).toEqual([]);
    expect(() => lines.push('123456\n')).toThrow('protocol record exceeds');
  });
});
