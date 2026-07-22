// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

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

    it('exposes a plain-language tip on queued status', () => {
      render(<RagStatusBadge status="queued" documentId="doc-1" />);
      expect(
        screen.getByTitle('documents.rag.status.queuedHint'),
      ).toBeInTheDocument();
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

    it('passes axe audit with unsupported status', async () => {
      const { container } = render(
        <RagStatusBadge status="unsupported" documentId="doc-1" />,
      );
      await checkAccessibility(container);
    });
  });

  // Issue #2598: a format with no text extractor is a terminal state, not a
  // transient one — unlike `failed`, it must never offer a retry affordance
  // (retrying can never succeed).
  describe('unsupported status', () => {
    it('renders without a retry button', () => {
      render(<RagStatusBadge status="unsupported" documentId="doc-1" />);
      expect(
        screen.queryByRole('button', { name: 'documents.rag.retryIndexing' }),
      ).not.toBeInTheDocument();
    });

    it('still offers a retry button for the transient failed status', () => {
      render(
        <RagStatusBadge status="failed" error="boom" documentId="doc-1" />,
      );
      expect(
        screen.getByRole('button', { name: 'documents.rag.retryIndexing' }),
      ).toBeInTheDocument();
    });

    // Regression: the dialog omitted the `description` prop its `completed`/
    // `failed` siblings pass, so the explanation was never auto-announced to
    // screen readers on open (no `aria-describedby` wiring).
    it('auto-announces the explanation via the dialog description on open', () => {
      render(<RagStatusBadge status="unsupported" documentId="doc-1" />);
      fireEvent.click(
        screen.getByRole('button', {
          name: 'documents.rag.dialog.unsupported.title',
        }),
      );
      expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
        'documents.rag.dialog.unsupported.description',
      );
    });
  });
});
