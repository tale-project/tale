import { describe, it, expect } from 'vitest';

import { findBlockSplitPoint } from '../find-block-split';

describe('findBlockSplitPoint', () => {
  describe('basic splitting', () => {
    it('returns 0 when no double newline exists', () => {
      expect(findBlockSplitPoint('Hello world', 11)).toBe(0);
    });

    it('returns 0 when revealPosition is before any double newline', () => {
      expect(findBlockSplitPoint('Hello\n\nWorld', 5)).toBe(0);
    });

    it('splits at the double newline before revealPosition', () => {
      const text = 'Para 1.\n\nPara 2.';
      expect(findBlockSplitPoint(text, text.length)).toBe(9);
    });

    it('splits at the LAST double newline before revealPosition', () => {
      const text = 'A.\n\nB.\n\nC.';
      expect(findBlockSplitPoint(text, text.length)).toBe(8);
    });

    it('returns 0 when revealPosition is 0', () => {
      expect(findBlockSplitPoint('A.\n\nB.', 0)).toBe(0);
    });

    it('returns 0 for empty text', () => {
      expect(findBlockSplitPoint('', 0)).toBe(0);
    });

    it('handles reveal at the double newline boundary', () => {
      const text = 'Para 1.\n\nPara 2.';
      expect(findBlockSplitPoint(text, 9)).toBe(9);
    });

    it('handles reveal just before the second newline', () => {
      const text = 'Para 1.\n\nPara 2.';
      expect(findBlockSplitPoint(text, 8)).toBe(0);
    });

    it('handles multiple paragraphs', () => {
      const text = 'One.\n\nTwo.\n\nThree.\n\nFour.';
      expect(findBlockSplitPoint(text, text.length)).toBe(20);
    });
  });

  describe('fenced code blocks', () => {
    it('does not split inside a backtick code fence', () => {
      const text = '```\nline1\n\nline2\n```\n\nAfter.';
      expect(findBlockSplitPoint(text, text.length)).toBe(22);
    });

    it('does not split inside a tilde code fence', () => {
      const text = '~~~\nline1\n\nline2\n~~~\n\nAfter.';
      expect(findBlockSplitPoint(text, text.length)).toBe(22);
    });

    it('does not split inside a 4-backtick fence', () => {
      const text = '````\nline1\n\nline2\n````\n\nAfter.';
      expect(findBlockSplitPoint(text, text.length)).toBe(24);
    });

    it('handles code fence followed by paragraph', () => {
      const text = 'Before.\n\n```js\ncode\n```\n\nAfter.';
      expect(findBlockSplitPoint(text, text.length)).toBe(25);
    });

    it('does not close a 4-backtick fence with 3 backticks', () => {
      const text = '````\nline1\n\n```\nline2\n````\n\nAfter.';
      expect(findBlockSplitPoint(text, text.length)).toBe(28);
    });

    it('handles unclosed code fence — everything stays in streaming', () => {
      const text = 'Before.\n\n```\ncode\n\nmore code';
      expect(findBlockSplitPoint(text, text.length)).toBe(9);
    });
  });

  describe('edge cases', () => {
    it('handles consecutive double newlines', () => {
      const text = 'A.\n\n\n\nB.';
      expect(findBlockSplitPoint(text, text.length)).toBe(6);
    });

    it('handles headings', () => {
      const text = '# Title\n\nContent.';
      expect(findBlockSplitPoint(text, text.length)).toBe(9);
    });

    it('handles lists', () => {
      const text = '- Item 1\n- Item 2\n\nParagraph.';
      expect(findBlockSplitPoint(text, text.length)).toBe(19);
    });

    it('handles tables', () => {
      const text = '| A | B |\n|---|---|\n| 1 | 2 |\n\nAfter.';
      expect(findBlockSplitPoint(text, text.length)).toBe(31);
    });

    it('handles thematic breaks', () => {
      const text = 'Before.\n\n---\n\nAfter.';
      expect(findBlockSplitPoint(text, text.length)).toBe(14);
    });

    it('revealPosition beyond text length is clamped', () => {
      const text = 'A.\n\nB.';
      expect(findBlockSplitPoint(text, 100)).toBe(4);
    });

    it('handles CJK text with double newlines', () => {
      const text = '第一段。\n\n第二段。';
      expect(findBlockSplitPoint(text, text.length)).toBe(6);
    });

    it('handles indented code fence (up to 3 spaces)', () => {
      const text = '   ```\nline1\n\nline2\n   ```\n\nAfter.';
      expect(findBlockSplitPoint(text, text.length)).toBe(28);
    });

    it('does not treat 4-space indented backticks as fence', () => {
      const text = '    ```\nline1\n\nline2';
      expect(findBlockSplitPoint(text, text.length)).toBe(15);
    });
  });
});
