import { describe, expect, it } from 'vitest';

import {
  CAPTION_PROFILE,
  joinSegmentsWithParagraphs,
  type ParagraphSegment,
} from './paragraphize';

const seg = (
  startSec: number,
  endSec: number,
  text: string,
  speaker?: string,
): ParagraphSegment => ({ startSec, endSec, text, speaker });

describe('joinSegmentsWithParagraphs', () => {
  describe('fallback', () => {
    it('returns trimmed fallbackText when segments are missing', () => {
      expect(joinSegmentsWithParagraphs(undefined, '  hello world  ')).toBe(
        'hello world',
      );
    });

    it('returns trimmed fallbackText when segments are empty', () => {
      expect(joinSegmentsWithParagraphs([], 'foo')).toBe('foo');
    });

    it('does not emit timestamp prefix on fallback path', () => {
      expect(
        joinSegmentsWithParagraphs(undefined, 'foo', { addTimestamps: true }),
      ).toBe('foo');
    });
  });

  describe('WHISPER_PROFILE (default)', () => {
    it('joins segments with no breaks when gap < pauseSec and total duration < maxDurationSec', () => {
      const segs = [seg(0, 2, 'Hello'), seg(2.1, 4, ' world')];
      expect(joinSegmentsWithParagraphs(segs, '')).toBe('Hello world');
    });

    it('breaks paragraphs at gaps >= 1.5s (WHISPER pauseSec)', () => {
      const segs = [
        seg(0, 2, 'First.'),
        seg(3.6, 5, 'Second.'), // gap = 1.6s >= 1.5
      ];
      expect(joinSegmentsWithParagraphs(segs, '')).toBe('First.\n\nSecond.');
    });

    it('keeps single paragraph when gap < 1.5s', () => {
      const segs = [
        seg(0, 2, 'First.'),
        seg(3.4, 5, 'Second.'), // gap = 1.4s < 1.5
      ];
      expect(joinSegmentsWithParagraphs(segs, '')).toBe('First.Second.');
    });

    it('forces paragraph break when adding next segment would push beyond maxDurationSec (45s)', () => {
      const segs = [
        seg(0, 20, 'A.'),
        seg(20, 40, 'B.'),
        seg(40, 50, 'C.'), // at C, accumulated would be 50 >= 45 → break BEFORE pushing C
        seg(50, 60, 'D.'),
      ];
      const out = joinSegmentsWithParagraphs(segs, '');
      expect(out.split('\n\n')).toEqual(['A.B.', 'C.D.']);
    });

    it('drops empty paragraphs', () => {
      const segs = [seg(0, 1, '   '), seg(3, 4, 'real')];
      expect(joinSegmentsWithParagraphs(segs, '')).toBe('real');
    });
  });

  describe('CAPTION_PROFILE', () => {
    it('uses tighter pauseSec=0.8', () => {
      const segs = [
        seg(0, 2, 'A.'),
        seg(2.9, 4, 'B.'), // gap = 0.9 >= 0.8 → break
      ];
      expect(
        joinSegmentsWithParagraphs(segs, '', { profile: CAPTION_PROFILE }),
      ).toBe('A.\n\nB.');
    });

    it('uses tighter maxDurationSec=30', () => {
      const segs = [
        seg(0, 15, 'A.'),
        seg(15, 30, 'B.'), // at B, accumulated would be 30 >= 30 → break BEFORE B
        seg(30, 35, 'C.'),
      ];
      const out = joinSegmentsWithParagraphs(segs, '', {
        profile: CAPTION_PROFILE,
      });
      expect(out.split('\n\n')).toEqual(['A.', 'B.C.']);
    });

    it('treats negative gaps (overlapping cues) as zero — no spurious breaks', () => {
      const segs = [
        seg(0, 2, 'A.'),
        seg(1.5, 3, 'B.'), // gap = -0.5
      ];
      expect(
        joinSegmentsWithParagraphs(segs, '', { profile: CAPTION_PROFILE }),
      ).toBe('A.B.');
    });
  });

  describe('addTimestamps', () => {
    it('prefixes each paragraph with [HH:MM:SS]', () => {
      const segs = [
        seg(0, 5, 'Intro.'),
        seg(10, 15, 'Body.'), // gap 5s → break
      ];
      const out = joinSegmentsWithParagraphs(segs, '', { addTimestamps: true });
      expect(out).toBe('[00:00:00] Intro.\n\n[00:00:10] Body.');
    });

    it('handles hour boundaries with zero-padded fixed-width format', () => {
      const segs = [
        seg(0, 5, 'A.'),
        seg(3725, 3730, 'B.'), // 1h 02m 05s
      ];
      const out = joinSegmentsWithParagraphs(segs, '', { addTimestamps: true });
      expect(out).toBe('[00:00:00] A.\n\n[01:02:05] B.');
    });

    it('emits monotonic non-decreasing timestamps', () => {
      const segs = [seg(0, 1, 'A.'), seg(60, 61, 'B.'), seg(120, 121, 'C.')];
      const out = joinSegmentsWithParagraphs(segs, '', { addTimestamps: true });
      const matches = [...out.matchAll(/\[(\d{2}:\d{2}:\d{2})\]/g)].map(
        (m) => m[1],
      );
      expect(matches).toEqual(['00:00:00', '00:01:00', '00:02:00']);
    });

    it('every paragraph matches /^\\[\\d{2}:\\d{2}:\\d{2}\\] /', () => {
      const segs = [seg(0, 5, 'A.'), seg(10, 15, 'B.'), seg(60, 65, 'C.')];
      const out = joinSegmentsWithParagraphs(segs, '', { addTimestamps: true });
      for (const para of out.split('\n\n')) {
        expect(para).toMatch(/^\[\d{2}:\d{2}:\d{2}\] /);
      }
    });
  });

  describe('speaker labels', () => {
    it('prepends Speaker: when speaker is set on first segment of paragraph', () => {
      const segs = [seg(0, 2, 'Hi.', 'Alice')];
      expect(joinSegmentsWithParagraphs(segs, '')).toBe('Alice: Hi.');
    });

    it('triggers a paragraph break when speaker changes', () => {
      const segs = [
        seg(0, 2, 'Hi.', 'Alice'),
        seg(2, 4, 'Hello.', 'Bob'), // same time, different speaker → break
      ];
      const out = joinSegmentsWithParagraphs(segs, '');
      expect(out).toBe('Alice: Hi.\n\nBob: Hello.');
    });

    it('combines speaker + timestamp prefix correctly', () => {
      const segs = [seg(0, 2, 'Hi.', 'Alice'), seg(60, 62, 'Hello.', 'Bob')];
      const out = joinSegmentsWithParagraphs(segs, '', { addTimestamps: true });
      expect(out).toBe('[00:00:00] Alice: Hi.\n\n[00:01:00] Bob: Hello.');
    });

    it('breaks paragraph when speaker transitions to undefined', () => {
      // Round-2 paragraphize fix: previously only "new speaker is
      // defined and differs" counted as a boundary, so unlabeled cues
      // following a labeled speaker would glue under that prefix. The
      // unlabeled cue should start a fresh, unlabeled paragraph.
      const segs = [
        seg(0, 2, 'Alice says hi.', 'Alice'),
        seg(2, 4, 'unlabeled body'),
      ];
      const out = joinSegmentsWithParagraphs(segs, '');
      expect(out).toBe('Alice: Alice says hi.\n\nunlabeled body');
    });

    it('breaks paragraph when speaker transitions from undefined to defined', () => {
      const segs = [
        seg(0, 2, 'unlabeled opener'),
        seg(2, 4, 'Bob speaks.', 'Bob'),
      ];
      const out = joinSegmentsWithParagraphs(segs, '');
      expect(out).toBe('unlabeled opener\n\nBob: Bob speaks.');
    });
  });

  describe('backward compatibility (Whisper output without timestamps)', () => {
    it('produces byte-identical output to legacy paragraphizer when addTimestamps=false', () => {
      // Mirrors the legacy `joinSegmentsWithParagraphs` from transcribe_audio.ts
      // before the extraction — same constants, same join shape.
      const segs = [
        seg(0, 2, 'First sentence.'),
        seg(3.6, 5, 'Second paragraph.'), // gap 1.6 >= 1.5
      ];
      expect(joinSegmentsWithParagraphs(segs, '')).toBe(
        'First sentence.\n\nSecond paragraph.',
      );
    });
  });
});
