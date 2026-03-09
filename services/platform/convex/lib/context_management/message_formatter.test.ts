import { describe, it, expect } from 'vitest';

import {
  formatKnowledgeBase,
  formatToolCallSummary,
  formatWebContext,
} from './message_formatter';

describe('message_formatter', () => {
  describe('formatKnowledgeBase', () => {
    it('should wrap content in details with knowledge heading', () => {
      const result = formatKnowledgeBase('Some RAG content');

      expect(result).toContain('<details');
      expect(result).toContain('Knowledge');
      expect(result).toContain('Some RAG content');
      expect(result).toContain('</details>');
    });
  });

  describe('formatWebContext', () => {
    it('should wrap content in details with web search heading', () => {
      const result = formatWebContext('Web search results here');

      expect(result).toContain('<details');
      expect(result).toContain('Web Search');
      expect(result).toContain('Web search results here');
      expect(result).toContain('</details>');
    });

    it('should produce distinct output from knowledge base', () => {
      const webResult = formatWebContext('content');
      const ragResult = formatKnowledgeBase('content');

      expect(webResult).not.toBe(ragResult);
    });
  });

  describe('formatToolCallSummary', () => {
    const ts = Date.now();

    it('should truncate at 8000 chars by default (no age)', () => {
      const longOutput = 'x'.repeat(10000);
      const result = formatToolCallSummary('my_tool', longOutput, ts);

      expect(result).toContain('my_tool');
      expect(result).toContain('✓');
      expect(result.length).toBeLessThan(10100);
      expect(result).toContain('...');
    });

    it('should truncate at 8000 chars for recent age', () => {
      const longOutput = 'x'.repeat(10000);
      const result = formatToolCallSummary(
        'my_tool',
        longOutput,
        ts,
        'success',
        'recent',
      );

      const outputPart = result.split(': ').slice(1).join(': ');
      expect(outputPart.length).toBeLessThanOrEqual(8004);
    });

    it('should truncate at 2000 chars for mid age', () => {
      const longOutput = 'x'.repeat(5000);
      const result = formatToolCallSummary(
        'my_tool',
        longOutput,
        ts,
        'success',
        'mid',
      );

      const outputPart = result.split(': ').slice(1).join(': ');
      expect(outputPart.length).toBeLessThanOrEqual(2004);
    });

    it('should truncate at 300 chars for old age', () => {
      const longOutput = 'x'.repeat(1000);
      const result = formatToolCallSummary(
        'my_tool',
        longOutput,
        ts,
        'success',
        'old',
      );

      const outputPart = result.split(': ').slice(1).join(': ');
      expect(outputPart.length).toBeLessThanOrEqual(304);
    });

    it('should use full 8000 limit for errors regardless of age', () => {
      const longOutput = 'x'.repeat(5000);
      const result = formatToolCallSummary(
        'my_tool',
        longOutput,
        ts,
        'error',
        'old',
      );

      expect(result).toContain('✗');
      const outputPart = result.split(': ').slice(1).join(': ');
      expect(outputPart.length).toBe(5000);
    });

    it('should not truncate short output', () => {
      const result = formatToolCallSummary(
        'my_tool',
        'short result',
        ts,
        'success',
        'old',
      );

      expect(result).toContain('short result');
      expect(result).not.toContain('...');
    });
  });
});
