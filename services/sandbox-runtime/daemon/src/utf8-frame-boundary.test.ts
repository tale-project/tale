import { describe, expect, test } from 'bun:test';

import { Utf8FrameBoundary } from './utf8-frame-boundary.ts';

describe('Utf8FrameBoundary', () => {
  for (const text of ['¢', '€', '😀']) {
    const bytes = Buffer.from(text);
    for (let split = 1; split < bytes.length; split += 1) {
      test(`${text} split after byte ${split} stays in one complete frame`, () => {
        const frames = new Utf8FrameBoundary();
        expect(frames.push(bytes.subarray(0, split))).toHaveLength(0);
        const frame = frames.push(bytes.subarray(split));
        expect(frame).toEqual(bytes);
        expect(new TextDecoder('utf-8', { fatal: true }).decode(frame)).toBe(
          text,
        );
        expect(frames.flush()).toHaveLength(0);
      });
    }
  }

  test('one-byte writes keep mixed text complete without buffering ASCII', () => {
    const text = 'before ¢ € 😀 after\n';
    const bytes = Buffer.from(text);
    const frames = new Utf8FrameBoundary();
    const output: Buffer[] = [];
    let received = 0;
    let sent = 0;
    for (const byte of bytes) {
      const frame = frames.push(Buffer.from([byte]));
      output.push(frame);
      received += frame.length;
      sent += 1;
      expect(sent - received).toBeLessThanOrEqual(3);
      new TextDecoder('utf-8', { fatal: true }).decode(frame);
    }
    output.push(frames.flush());
    expect(Buffer.concat(output)).toEqual(bytes);
    expect(
      output.map((frame) => new TextDecoder().decode(frame)).join(''),
    ).toBe(text);
  });

  test('invalid encodings and arbitrary binary bytes are preserved exactly', () => {
    const bytes = Buffer.concat([
      Buffer.from([0xc0, 0x80, 0xe0, 0x80, 0x80, 0xed, 0xa0, 0x80]),
      Buffer.from([0xf4, 0x90, 0x80, 0x80, 0xf5, 0x80, 0xff, 0xfe, 0]),
      Buffer.from(Array.from({ length: 256 }, (_value, index) => index)),
    ]);
    for (let size = 1; size <= 7; size += 1) {
      const frames = new Utf8FrameBoundary();
      const output: Buffer[] = [];
      let received = 0;
      for (let offset = 0; offset < bytes.length; offset += size) {
        const chunk = bytes.subarray(offset, offset + size);
        const frame = frames.push(chunk);
        output.push(frame);
        received += frame.length;
        expect(
          Math.min(bytes.length, offset + size) - received,
        ).toBeLessThanOrEqual(3);
      }
      output.push(frames.flush());
      expect(Buffer.concat(output)).toEqual(bytes);
    }
    expect(new Utf8FrameBoundary().push(Buffer.from([0xe0, 0x80]))).toEqual(
      Buffer.from([0xe0, 0x80]),
    );
  });

  test('EOF flush returns incomplete raw bytes once', () => {
    for (const bytes of [
      Buffer.from([0xc2]),
      Buffer.from([0xe2, 0x82]),
      Buffer.from([0xf0, 0x9f, 0x98]),
    ]) {
      const frames = new Utf8FrameBoundary();
      expect(frames.push(bytes)).toHaveLength(0);
      expect(frames.flush()).toEqual(bytes);
      expect(frames.flush()).toHaveLength(0);
    }
  });

  test('separate stdout and stderr framers do not mix pending bytes', () => {
    const stdout = new Utf8FrameBoundary();
    const stderr = new Utf8FrameBoundary();
    expect(stdout.push(Buffer.from([0xe2]))).toHaveLength(0);
    expect(stderr.push(Buffer.from([0xf0, 0x9f]))).toHaveLength(0);
    expect(stdout.push(Buffer.from([0x82, 0xac])).toString()).toBe('€');
    expect(stderr.push(Buffer.from([0x98, 0x80])).toString()).toBe('😀');
  });
});
