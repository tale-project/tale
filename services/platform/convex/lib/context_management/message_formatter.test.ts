import { describe, it, expect } from 'vitest';

import { formatKnowledgeBase, formatWebContext } from './message_formatter';

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
});
