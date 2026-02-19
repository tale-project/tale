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

  describe('all markers present', () => {
    it('parses all five markers in order', () => {
      const text = `[[CONCLUSION]]
The quick summary.

[[KEY_POINTS]]
- Point one
- Point two

[[DETAILS]]
Extended details here.

[[QUESTIONS]]
1. What is your budget?
2. Which region do you target?

[[NEXT_STEPS]]
Ask about X
Ask about Y`;

      const result = parseMarkers(text, false);
      expect(result.hasMarkers).toBe(true);
      expect(result.sections).toHaveLength(5);
      expect(result.sections[0]).toEqual({
        type: 'CONCLUSION',
        content: 'The quick summary.',
      });
      expect(result.sections[1]).toEqual({
        type: 'KEY_POINTS',
        content: '- Point one\n- Point two',
      });
      expect(result.sections[2]).toEqual({
        type: 'DETAILS',
        content: 'Extended details here.',
      });
      expect(result.sections[3]).toEqual({
        type: 'QUESTIONS',
        content: '1. What is your budget?\n2. Which region do you target?',
      });
      expect(result.sections[4]).toEqual({
        type: 'NEXT_STEPS',
        content: 'Ask about X\nAsk about Y',
      });
    });
  });

  describe('partial markers', () => {
    it('only some markers used', () => {
      const text = `[[CONCLUSION]]
Summary here.

[[KEY_POINTS]]
- Important point`;

      const result = parseMarkers(text, false);
      expect(result.hasMarkers).toBe(true);
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].type).toBe('CONCLUSION');
      expect(result.sections[1].type).toBe('KEY_POINTS');
    });

    it('single marker only', () => {
      const text = `[[CONCLUSION]]
Just a conclusion.`;

      const result = parseMarkers(text, false);
      expect(result.hasMarkers).toBe(true);
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0]).toEqual({
        type: 'CONCLUSION',
        content: 'Just a conclusion.',
      });
    });
  });

  describe('text before first marker', () => {
    it('includes preamble as plain section', () => {
      const text = `Let me research that for you.

[[CONCLUSION]]
Here is the answer.`;

      const result = parseMarkers(text, false);
      expect(result.hasMarkers).toBe(true);
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0]).toEqual({
        type: 'plain',
        content: 'Let me research that for you.',
      });
      expect(result.sections[1]).toEqual({
        type: 'CONCLUSION',
        content: 'Here is the answer.',
      });
    });
  });

  describe('inline markers (not on their own line)', () => {
    it('parses marker placed inline with surrounding text', () => {
      const text =
        '好的，让我搜索。 [[CONCLUSION]] 成功获取到 WiseKey 的财报信息。';

      const result = parseMarkers(text, false);
      expect(result.hasMarkers).toBe(true);
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0]).toEqual({
        type: 'plain',
        content: '好的，让我搜索。',
      });
      expect(result.sections[1]).toEqual({
        type: 'CONCLUSION',
        content: '成功获取到 WiseKey 的财报信息。',
      });
    });

    it('parses multiple inline markers', () => {
      const text =
        'Preamble text [[CONCLUSION]] The summary. [[KEY_POINTS]] - Point one\n- Point two';

      const result = parseMarkers(text, false);
      expect(result.hasMarkers).toBe(true);
      expect(result.sections).toHaveLength(3);
      expect(result.sections[0]).toEqual({
        type: 'plain',
        content: 'Preamble text',
      });
      expect(result.sections[1]).toEqual({
        type: 'CONCLUSION',
        content: 'The summary.',
      });
      expect(result.sections[2]).toEqual({
        type: 'KEY_POINTS',
        content: '- Point one\n- Point two',
      });
    });
  });

  describe('empty content after marker', () => {
    it('handles marker with no content after it', () => {
      const text = `[[CONCLUSION]]
Summary.

[[NEXT_STEPS]]`;

      const result = parseMarkers(text, false);
      expect(result.hasMarkers).toBe(true);
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0]).toEqual({
        type: 'CONCLUSION',
        content: 'Summary.',
      });
      expect(result.sections[1]).toEqual({
        type: 'NEXT_STEPS',
        content: '',
      });
    });
  });

  describe('streaming — partial marker buffering', () => {
    it('holds back partial marker at end of text', () => {
      const result = parseMarkers('Some plain text [[CONCLU', true);
      expect(result.hasMarkers).toBe(false);
      expect(result.sections).toEqual([
        { type: 'plain', content: 'Some plain text ' },
      ]);
      expect(result.pendingText).toBe('[[CONCLU');
    });

    it('holds back [[ at end of text', () => {
      const result = parseMarkers('Some text [[', true);
      expect(result.hasMarkers).toBe(false);
      expect(result.sections).toEqual([
        { type: 'plain', content: 'Some text ' },
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
      expect(result.sections[0].type).toBe('CONCLUSION');
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

      // Phase 2: first marker appears
      const r2 = parseMarkers(
        'Working on it...\n\n[[CONCLUSION]]\nHere is the',
        true,
      );
      expect(r2.hasMarkers).toBe(true);
      expect(r2.sections[0].type).toBe('plain');
      expect(r2.sections[1].type).toBe('CONCLUSION');
      expect(r2.sections[1].content).toBe('Here is the');

      // Phase 3: second marker appears
      const r3 = parseMarkers(
        'Working on it...\n\n[[CONCLUSION]]\nHere is the answer.\n\n[[KEY_POINTS]]\n- First',
        true,
      );
      expect(r3.hasMarkers).toBe(true);
      expect(r3.sections).toHaveLength(3);
      expect(r3.sections[2].type).toBe('KEY_POINTS');
    });
  });
});
