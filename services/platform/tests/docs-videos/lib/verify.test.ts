import { describe, expect, it } from 'vitest';

import { parseSpeechIntervals, verifySpeechCoverage } from './verify';

const STDERR_SAMPLE = `
[silencedetect @ 0x600] silence_start: 0
[silencedetect @ 0x600] silence_end: 1.7 | silence_duration: 1.7
[silencedetect @ 0x600] silence_start: 9.2
[silencedetect @ 0x600] silence_end: 10.4 | silence_duration: 1.2
[silencedetect @ 0x600] silence_start: 18.05
`;

describe('parseSpeechIntervals', () => {
  it('inverts silences into speech over the track, closing a trailing open silence', () => {
    expect(parseSpeechIntervals(STDERR_SAMPLE, 20_000)).toEqual([
      { startMs: 1700, endMs: 9200 },
      { startMs: 10_400, endMs: 18_050 },
    ]);
  });

  it('treats a track with no detected silence as fully audible', () => {
    expect(parseSpeechIntervals('', 5000)).toEqual([
      { startMs: 0, endMs: 5000 },
    ]);
  });
});

describe('verifySpeechCoverage', () => {
  const speech = [{ startMs: 1700, endMs: 9200 }];

  it('passes a well-covered narration window', () => {
    expect(
      verifySpeechCoverage(
        [{ id: 'intro', startMs: 1500, durationMs: 7000 }],
        speech,
      ),
    ).toEqual([]);
  });

  it('flags a silent narration window', () => {
    const issues = verifySpeechCoverage(
      [{ id: 'lost-scene', startMs: 12_000, durationMs: 4000 }],
      speech,
    );
    expect(issues).toHaveLength(2); // silent window + early-speech offset
    expect(issues[0]?.where).toBe('lost-scene');
    expect(issues[0]?.detail).toContain('0% audible');
  });

  it('flags speech well before the first narration (global offset)', () => {
    const issues = verifySpeechCoverage(
      [{ id: 'title', startMs: 5000, durationMs: 4000 }],
      [{ startMs: 500, endMs: 9000 }],
    );
    expect(issues.some((issue) => issue.where === 'lead-in')).toBe(true);
  });
});
