import { describe, expect, it } from 'vitest';

import {
  BoundedIdLedger,
  HARNESS_ID_LEDGER_MAX_ENTRIES,
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

describe('bounded harness deduplication ledger', () => {
  it('accepts duplicates at the entry cap and refuses new facts without eviction', () => {
    const ledger = new BoundedIdLedger();
    for (let index = 0; index < HARNESS_ID_LEDGER_MAX_ENTRIES; index += 1)
      ledger.add(String(index));
    ledger.add('0');
    expect(() => ledger.add('overflow')).toThrow('memory budget');
    expect(ledger.has('0')).toBe(true);
    expect(ledger.has(String(HARNESS_ID_LEDGER_MAX_ENTRIES - 1))).toBe(true);
    expect(ledger.has('overflow')).toBe(false);
    const freshWindow = new BoundedIdLedger();
    expect(freshWindow.has('0')).toBe(false);
    freshWindow.add('overflow');
    expect(freshWindow.has('overflow')).toBe(true);
  });

  it('caps individual IDs and their total retained characters independently of count', () => {
    const ledger = new BoundedIdLedger();
    expect(() => ledger.add('x'.repeat(4097))).toThrow('identifier exceeds');
    for (let index = 0; index < 256; index += 1)
      ledger.add(`${'x'.repeat(4091)}${String(index).padStart(5, '0')}`);
    ledger.add(`${'x'.repeat(4091)}00000`);
    expect(() => ledger.add('one-more-character')).toThrow('memory budget');
  });
});
