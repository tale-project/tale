import { describe, expect, it } from 'vitest';

import {
  HarnessJsonlRecordTooLargeError,
  appendHarnessAnswer,
  HARNESS_RECORD_MAX_CHARS,
  LineReassembler,
  MAX_HARNESS_JSONL_RECORD_BYTES,
} from './jsonl';

describe('bounded JSONL records', () => {
  it('rejects repeated unterminated chunks and never emits a surviving suffix', () => {
    const lines = new LineReassembler();
    const chunk = 'x'.repeat(256 * 1024);
    for (let i = 0; i < 32; i++) expect(lines.push(chunk)).toEqual([]);
    expect(lines.snapshot().length).toBe(MAX_HARNESS_JSONL_RECORD_BYTES);
    expect(() => lines.push('x')).toThrow(HarnessJsonlRecordTooLargeError);
    expect(() => lines.push('safe suffix\n')).toThrow(
      HarnessJsonlRecordTooLargeError,
    );
    expect(() => lines.flush()).toThrow(HarnessJsonlRecordTooLargeError);
  });

  it('rejects a complete oversized record before returning later records', () => {
    const lines = new LineReassembler();
    expect(() =>
      lines.push(`${'x'.repeat(MAX_HARNESS_JSONL_RECORD_BYTES + 1)}\n{}\n`),
    ).toThrow(HarnessJsonlRecordTooLargeError);
  });

  it('bounds restored partial state and counts UTF-8 bytes, not characters', () => {
    const lines = new LineReassembler();
    expect(() =>
      lines.restore(
        '€'.repeat(Math.floor(MAX_HARNESS_JSONL_RECORD_BYTES / 3) + 1),
      ),
    ).toThrow(HarnessJsonlRecordTooLargeError);
  });

  it('preserves a 70KiB answer through a snapshot and a split surrogate pair', () => {
    const lines = new LineReassembler();
    const prefix = `{"answer":"${'x'.repeat(70 * 1024)}`;
    lines.push(prefix + '\ud83d');
    const resumed = new LineReassembler();
    resumed.restore(lines.snapshot());
    expect(resumed.push('\ude80"}\n')).toEqual([prefix + '🚀"}']);
  });

  it('applies the cap per record even when one chunk contains many records', () => {
    const line = 'x'.repeat(1024 * 1024);
    expect(new LineReassembler().push((line + '\n').repeat(9))).toEqual(
      Array(9).fill(line),
    );
  });
});

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
    expect(() => lines.push('456')).toThrow(HarnessJsonlRecordTooLargeError);
    expect(() => lines.flush()).toThrow(HarnessJsonlRecordTooLargeError);
    expect(() => lines.push('123456\n')).toThrow(
      HarnessJsonlRecordTooLargeError,
    );
  });
});
