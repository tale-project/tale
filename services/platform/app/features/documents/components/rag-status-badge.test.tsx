// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'test-org-id' }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({
    formatDate: (date: Date) => date.toISOString(),
  }),
}));

vi.mock('@/convex/lib/type_cast_helpers', () => ({
  toId: (id: string) => id,
}));

vi.mock('../hooks/actions', () => ({
  useRetryRagIndexing: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { RagStatusBadge } from './rag-status-badge';

describe('RagStatusBadge', () => {
  describe('accessibility', () => {
    it('passes axe audit with completed status', async () => {
      const { container } = render(
        <RagStatusBadge
          status="completed"
          indexedAt={1700000000}
          documentId="doc-1"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with failed status', async () => {
      const { container } = render(
        <RagStatusBadge
          status="failed"
          error="Indexing failed"
          documentId="doc-1"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with queued status', async () => {
      const { container } = render(
        <RagStatusBadge status="queued" documentId="doc-1" />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with not_indexed status', async () => {
      const { container } = render(
        <RagStatusBadge status="not_indexed" documentId="doc-1" />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with stale status', async () => {
      const { container } = render(
        <RagStatusBadge status="stale" documentId="doc-1" />,
      );
      await checkAccessibility(container);
    });
  });
});
