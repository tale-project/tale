import { describe, it, expect } from 'vitest';

import { parseMarkers } from './marker-parser';

describe('parseMarkers', () => {
  describe('no markers', () => {
    it('returns single plain section for text without markers', () => {
      const result = parseMarkers('Hello, how can I help you?', false);
      expect(result.hasMarkers).toBe(false);
      expect(result.sections).toEqual([
        { type: 'plain', content: 'Hello, how can I help you?' },
      ]);
      expect(result.pendingText).toBe('');
    });

    it('returns empty result for empty text', () => {
      const result = parseMarkers('', false);
      expect(result.hasMarkers).toBe(false);
      expect(result.sections).toEqual([]);
      expect(result.pendingText).toBe('');
    });

    it('treats [[INVALID]] as plain text', () => {
      const result = parseMarkers('Some text [[INVALID]] more text', false);
      expect(result.hasMarkers).toBe(false);
      expect(result.sections).toEqual([
        { type: 'plain', content: 'Some text [[INVALID]] more text' },
      ]);
    });
  });

  describe('stripped markers (no special rendering)', () => {
    it('strips [[CONCLUSION]] and renders content as plain', () => {
      const text = `[[CONCLUSION]]
Just a conclusion.`;

      const result = parseMarkers(text, false);
      expect(result.hasMarkers).toBe(true);
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0]).toEqual({
        type: 'plain',
        content: 'Just a conclusion.',
      });
    });

    it('strips all non-NEXT_STEPS markers and merges content as plain', () => {
      const text = `[[CONCLUSION]]
The quick summary.

[[KEY_POINTS]]
- Point one
- Point two

[[DETAILS]]
Extended details here.

[[QUESTIONS]]
1. What is your budget?
2. Which region do you target?`;

      const result = parseMarkers(text, false);
      expect(result.hasMarkers).toBe(true);
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].type).toBe('plain');
      expect(result.sections[0].content).toContain('The quick summary.');
      expect(result.sections[0].content).toContain('- Point one');
      expect(result.sections[0].content).toContain('Extended details here.');
      expect(result.sections[0].content).toContain('What is your budget?');
    });

    it('strips inline marker and keeps surrounding text', () => {
      const text =
        '好的，让我搜索。 [[CONCLUSION]] 成功获取到 WiseKey 的财报信息。';

      const result = parseMarkers(text, false);
      expect(result.hasMarkers).toBe(true);
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0]).toEqual({
        type: 'plain',
        content: '好的，让我搜索。  成功获取到 WiseKey 的财报信息。',
      });
    });
  });

  describe('NEXT_STEPS marker (special rendering)', () => {
    it('splits on [[NEXT_STEPS]] and creates a section', () => {
      const text = `[[CONCLUSION]]
The quick summary.

[[NEXT_STEPS]]
Ask about X
Ask about Y`;

      const result = parseMarkers(text, false);
      expect(result.hasMarkers).toBe(true);
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0]).toEqual({
        type: 'plain',
        content: 'The quick summary.',
      });
      expect(result.sections[1]).toEqual({
        type: 'NEXT_STEPS',
        content: 'Ask about X\nAsk about Y',
      });
    });

    it('handles NEXT_STEPS with no preceding content', () => {
      const text = `[[NEXT_STEPS]]
Ask about X`;

      const result = parseMarkers(text, false);
      expect(result.hasMarkers).toBe(true);
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0]).toEqual({
        type: 'NEXT_STEPS',
        content: 'Ask about X',
      });
    });

    it('handles NEXT_STEPS with empty content', () => {
      const text = `[[CONCLUSION]]
Summary.

[[NEXT_STEPS]]`;

      const result = parseMarkers(text, false);
      expect(result.hasMarkers).toBe(true);
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0]).toEqual({
        type: 'plain',
        content: 'Summary.',
      });
      expect(result.sections[1]).toEqual({
        type: 'NEXT_STEPS',
        content: '',
      });
    });

    it('handles all markers with NEXT_STEPS at the end', () => {
      const text = `[[CONCLUSION]]
The quick summary.

[[KEY_POINTS]]
- Point one
- Point two

[[DETAILS]]
Extended details here.

[[QUESTIONS]]
1. What is your budget?

[[NEXT_STEPS]]
Ask about X
Ask about Y`;

      const result = parseMarkers(text, false);
      expect(result.hasMarkers).toBe(true);
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].type).toBe('plain');
      expect(result.sections[0].content).toContain('The quick summary.');
      expect(result.sections[0].content).toContain('- Point one');
      expect(result.sections[1]).toEqual({
        type: 'NEXT_STEPS',
        content: 'Ask about X\nAsk about Y',
      });
    });
  });

  describe('text before first marker', () => {
    it('preserves preamble text when markers are stripped', () => {
      const text = `Let me research that for you.

[[CONCLUSION]]
Here is the answer.`;

      const result = parseMarkers(text, false);
      expect(result.hasMarkers).toBe(true);
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].type).toBe('plain');
      expect(result.sections[0].content).toContain(
        'Let me research that for you.',
      );
      expect(result.sections[0].content).toContain('Here is the answer.');
    });
  });

  describe('streaming — partial marker buffering', () => {
    it('holds back partial marker at end of text', () => {
      const result = parseMarkers('Some plain text [[CONCLU', true);
      expect(result.hasMarkers).toBe(false);
      expect(result.sections).toEqual([
        { type: 'plain', content: 'Some plain text' },
      ]);
      expect(result.pendingText).toBe('[[CONCLU');
    });

    it('holds back [[ at end of text', () => {
      const result = parseMarkers('Some text [[', true);
      expect(result.hasMarkers).toBe(false);
      expect(result.sections).toEqual([
        { type: 'plain', content: 'Some text' },
      ]);
      expect(result.pendingText).toBe('[[');
    });

    it('does not hold back when not streaming', () => {
      const result = parseMarkers('Some text [[CONCLU', false);
      expect(result.hasMarkers).toBe(false);
      expect(result.sections).toEqual([
        { type: 'plain', content: 'Some text [[CONCLU' },
      ]);
      expect(result.pendingText).toBe('');
    });

    it('releases held text once marker completes', () => {
      const text = `[[CONCLUSION]]
The answer.`;
      const result = parseMarkers(text, true);
      expect(result.hasMarkers).toBe(true);
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].type).toBe('plain');
      expect(result.sections[0].content).toBe('The answer.');
      expect(result.pendingText).toBe('');
    });

    it('handles only pending text during streaming', () => {
      const result = parseMarkers('[[', true);
      expect(result.hasMarkers).toBe(false);
      expect(result.sections).toEqual([]);
      expect(result.pendingText).toBe('[[');
    });

    it('does not hold back text that exceeds max marker length', () => {
      const longPartial = '[[THIS_IS_WAY_TOO_LONG';
      const result = parseMarkers(`text ${longPartial}`, true);
      expect(result.pendingText).toBe('');
      expect(result.sections).toEqual([
        { type: 'plain', content: `text ${longPartial}` },
      ]);
    });
  });

  describe('streaming — progressive parsing', () => {
    it('handles growing text with markers appearing over time', () => {
      // Phase 1: only plain text
      const r1 = parseMarkers('Working on it...', true);
      expect(r1.hasMarkers).toBe(false);
      expect(r1.sections[0].content).toBe('Working on it...');

      // Phase 2: stripped marker appears — still plain
      const r2 = parseMarkers(
        'Working on it...\n\n[[CONCLUSION]]\nHere is the',
        true,
      );
      expect(r2.hasMarkers).toBe(true);
      expect(r2.sections).toHaveLength(1);
      expect(r2.sections[0].type).toBe('plain');
      expect(r2.sections[0].content).toContain('Here is the');

      // Phase 3: NEXT_STEPS appears — creates a split
      const r3 = parseMarkers(
        'Working on it...\n\n[[CONCLUSION]]\nHere is the answer.\n\n[[NEXT_STEPS]]\nAsk about X',
        true,
      );
      expect(r3.hasMarkers).toBe(true);
      expect(r3.sections).toHaveLength(2);
      expect(r3.sections[0].type).toBe('plain');
      expect(r3.sections[1].type).toBe('NEXT_STEPS');
      expect(r3.sections[1].content).toBe('Ask about X');
    });
  });
});
