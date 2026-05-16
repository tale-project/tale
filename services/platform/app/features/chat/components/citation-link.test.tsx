import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { CitationLink } from './citation-link';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const translations: Record<string, string> = {
        'citations.viewDocument': 'View document',
      };
      if (key === 'citations.source' && params?.number) {
        return `Source ${params.number}`;
      }
      if (key === 'citations.page' && params?.page) {
        return `Page ${params.page}`;
      }
      if (key === 'citations.relevance' && params?.score) {
        return `Relevance: ${params.score}%`;
      }
      return translations[key] ?? key;
    },
  }),
}));

describe('CitationLink', () => {
  describe('accessibility', () => {
    it('passes axe audit with minimal citation', async () => {
      const { container } = render(
        <CitationLink citation={{ number: 1, type: 'rag' }} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with full citation data', async () => {
      const { container } = render(
        <CitationLink
          citation={{
            number: 2,
            filename: 'report.pdf',
            fileId: 'file-123',
            page: 5,
            relevance: 87.5,
            type: 'rag',
          }}
          onNavigate={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
