import { describe, expect, it } from 'vitest';

import {
  HarnessJsonlRecordTooLargeError,
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
