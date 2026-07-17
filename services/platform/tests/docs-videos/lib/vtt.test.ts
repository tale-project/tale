import { describe, expect, test } from 'vitest';

import {
  buildVtt,
  formatVttTimestamp,
  narrationToCues,
  stripAudioTags,
} from './vtt';

describe('stripAudioTags', () => {
  test('removes delivery tags and collapses whitespace', () => {
    expect(
      stripAudioTags('[warmly] Welcome to Tale. [pause] Let us begin.'),
    ).toBe('Welcome to Tale. Let us begin.');
  });

  test('leaves untagged prose alone', () => {
    expect(stripAudioTags('Plain sentence.')).toBe('Plain sentence.');
  });
});

describe('formatVttTimestamp', () => {
  test('renders HH:MM:SS.mmm', () => {
    expect(formatVttTimestamp(0)).toBe('00:00:00.000');
    expect(formatVttTimestamp(61_234)).toBe('00:01:01.234');
    expect(formatVttTimestamp(3_600_000 + 62_005)).toBe('01:01:02.005');
  });
});

describe('narrationToCues', () => {
  test('one short sentence becomes one cue spanning the duration', () => {
    const cues = narrationToCues('Welcome to Tale.', 1000, 2000);
    expect(cues).toEqual([
      { startMs: 1000, endMs: 3000, text: 'Welcome to Tale.' },
    ]);
  });

  test('duration splits across sentences by character share', () => {
    const cues = narrationToCues(
      'Short one. This second sentence is quite a bit longer.',
      0,
      6000,
    );
    expect(cues).toHaveLength(2);
    expect(cues[0]?.startMs).toBe(0);
    expect(cues.at(-1)?.endMs).toBe(6000);
    const first = (cues[0]?.endMs ?? 0) - (cues[0]?.startMs ?? 0);
    const second = (cues[1]?.endMs ?? 0) - (cues[1]?.startMs ?? 0);
    expect(second).toBeGreaterThan(first);
  });

  test('long sentences are chunked and wrapped to two lines max', () => {
    const long =
      'Tale grounds every answer in the documents your team already trusts, so you can verify a claim instead of taking it on faith.';
    const cues = narrationToCues(long, 0, 8000);
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) {
      const lines = cue.text.split('\n');
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(42);
    }
  });

  test('audio tags never reach the captions', () => {
    const cues = narrationToCues('[calm] Grounded answers. Always.', 0, 3000);
    expect(cues.map((c) => c.text).join(' ')).not.toContain('[');
  });

  test('empty narration yields no cues', () => {
    expect(narrationToCues('  ', 0, 1000)).toEqual([]);
    expect(narrationToCues('Hello.', 0, 0)).toEqual([]);
  });
});

describe('buildVtt', () => {
  test('serializes numbered cues under a WEBVTT header', () => {
    const vtt = buildVtt([
      { startMs: 0, endMs: 1500, text: 'Hello.' },
      { startMs: 1500, endMs: 4000, text: 'Two lines\nof text.' },
    ]);
    expect(vtt).toBe(
      [
        'WEBVTT',
        '',
        '1',
        '00:00:00.000 --> 00:00:01.500',
        'Hello.',
        '',
        '2',
        '00:00:01.500 --> 00:00:04.000',
        'Two lines',
        'of text.',
        '',
      ].join('\n') + '\n',
    );
  });

  test('rejects overlapping cues', () => {
    expect(() =>
      buildVtt([
        { startMs: 0, endMs: 2000, text: 'a' },
        { startMs: 1999, endMs: 3000, text: 'b' },
      ]),
    ).toThrow(/before the previous cue ended/);
  });

  test('rejects non-positive cue durations', () => {
    expect(() => buildVtt([{ startMs: 5, endMs: 5, text: 'x' }])).toThrow(
      /non-positive duration/,
    );
  });
});
