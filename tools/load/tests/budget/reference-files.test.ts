import { describe, expect, test } from 'bun:test';
import { inflateSync } from 'node:zlib';

import * as XLSX from 'xlsx';

import {
  referencePdf,
  referenceRecording,
  referenceSpreadsheet,
} from '../../src/data/reference-files.ts';

describe('the reference spreadsheet', () => {
  test('is an xlsx whose cells SheetJS reads back, the same on every run', () => {
    const first = referenceSpreadsheet(200, 10);
    const second = referenceSpreadsheet(200, 10);
    expect(first.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(first.fileName).toBe('reference-200x10.xlsx');
    // A zip, as every Office Open XML file is.
    expect(Buffer.from(first.bytes.subarray(0, 2)).toString('latin1')).toBe(
      'PK',
    );
    const read = (bytes: Uint8Array): unknown[][] => {
      const book = XLSX.read(bytes, { type: 'buffer' });
      const sheet = book.Sheets[book.SheetNames[0] ?? ''];
      if (sheet === undefined) throw new Error('no sheet');
      return XLSX.utils.sheet_to_json(sheet, { header: 1 });
    };
    const rows = read(first.bytes);
    expect(rows).toHaveLength(200);
    expect(rows[0]).toEqual(
      Array.from({ length: 10 }, (_, index) => `Column ${index + 1}`),
    );
    expect(rows[1]?.[0]).toBe(1000);
    expect(typeof rows[1]?.[1]).toBe('number');
    expect(rows[1]?.[2]).toMatch(/^[a-z]+ [a-z]+$/);
    expect(rows[1]?.[3]).toMatch(/^[a-z]+-\d+$/);
    expect(read(second.bytes)).toEqual(rows);
  });
});

/** Every `N 0 obj` the xref names, at the offset it names. */
function checkXref(pdf: Buffer): number {
  const text = pdf.toString('latin1');
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  expect(text.slice(start, start + 4)).toBe('xref');
  const [, countText] = /^xref\n0 (\d+)\n/.exec(text.slice(start)) ?? [];
  const count = Number(countText);
  const entries = text
    .slice(start)
    .split('\n')
    .slice(3, 3 + count - 1);
  entries.forEach((entry, index) => {
    const offset = Number(entry.slice(0, 10));
    expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(
      `${index + 1} 0 obj`,
    );
  });
  return count - 1;
}

describe('the reference PDF', () => {
  test('a text report whose cross-reference table points at every object', () => {
    const pdf = referencePdf(3);
    const bytes = Buffer.from(pdf.bytes);
    expect(pdf.contentType).toBe('application/pdf');
    expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.5');
    // Catalog, page tree, font, and a content stream and a page each.
    expect(checkXref(bytes)).toBe(3 + 2 * 3);
    expect(bytes.toString('latin1')).toContain('/Count 3 >>');
    const text = bytes.toString('latin1');
    const streams = [...text.matchAll(/(?<!end)stream\n/g)].map((match) => {
      const from = (match.index ?? 0) + 'stream\n'.length;
      const to = text.indexOf('\nendstream', from);
      return inflateSync(bytes.subarray(from, to)).toString('latin1');
    });
    expect(streams).toHaveLength(3);
    expect(streams[1]).toContain('(Page 2 of the reference report) Tj');
    expect(streams[0]?.match(/\) Tj T\*/g)).toHaveLength(45);
    expect(Buffer.from(referencePdf(3).bytes).equals(bytes)).toBe(true);
  });
});

describe('the reference recording', () => {
  test('16 kHz mono 16-bit PCM: sound for seven seconds of ten, near silence for three', () => {
    const recording = referenceRecording(10);
    const bytes = Buffer.from(recording.bytes);
    expect(recording.contentType).toBe('audio/wav');
    expect(bytes.length).toBe(44 + 10 * 16_000 * 2);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(bytes.subarray(8, 16).toString('latin1')).toBe('WAVEfmt ');
    expect(bytes.readUInt16LE(22)).toBe(1);
    expect(bytes.readUInt32LE(24)).toBe(16_000);
    expect(bytes.readUInt16LE(34)).toBe(16);
    expect(bytes.readUInt32LE(40)).toBe(10 * 16_000 * 2);
    const peakOfSecond = (second: number): number => {
      let peak = 0;
      for (let sample = 0; sample < 16_000; sample += 1) {
        peak = Math.max(
          peak,
          Math.abs(bytes.readInt16LE(44 + (second * 16_000 + sample) * 2)),
        );
      }
      return peak;
    };
    expect(peakOfSecond(0)).toBeGreaterThan(5_000);
    expect(peakOfSecond(6)).toBeGreaterThan(5_000);
    expect(peakOfSecond(8)).toBeLessThan(50);
  });
});
