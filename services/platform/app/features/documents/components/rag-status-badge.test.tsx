// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

type MockLinkProps = React.ComponentProps<'a'> & {
  to?: string;
  params?: Record<string, string>;
  preload?: string | false;
};

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'test-org-id' }),
  Link: React.forwardRef<HTMLAnchorElement, MockLinkProps>(function Link(
    { to, params: _params, preload: _preload, children, ...rest },
    ref,
  ) {
    return (
      <a ref={ref} href={to} {...rest}>
        {children}
      </a>
    );
  }),
}));

const { canMock } = vi.hoisted(() => ({
  canMock: vi.fn((_action: string, _subject: string) => true),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: canMock }),
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

  // A failure caused by the org having no embedding model is fixable in
  // Settings → Data residency, so the failed dialog must guide there instead
  // of dead-ending on the raw error prose.
  describe('embedding-not-configured guidance', () => {
    afterEach(() => {
      canMock.mockImplementation(() => true);
    });

    const openFailedDialog = () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'documents.rag.dialog.failed.title',
        }),
      );
    };

    it('deep-links the embedding settings for members who can open org settings', () => {
      render(
        <RagStatusBadge
          status="failed"
          error='Organization "test" has no embedding model configured…'
          errorCode="embedding_not_configured"
          documentId="doc-1"
        />,
      );
      openFailedDialog();
      expect(
        screen.getByText(
          'documents.rag.dialog.failed.embeddingNotConfigured.hint',
        ),
      ).toBeInTheDocument();
      const link = screen.getByRole('link', {
        name: 'documents.rag.dialog.failed.embeddingNotConfigured.configureCta',
      });
      expect(link).toHaveAttribute(
        'href',
        '/dashboard/$id/settings/data-residency',
      );
    });

    it('points members without org-settings access at an admin instead', () => {
      canMock.mockImplementation(
        (_action: string, subject: string) => subject !== 'orgSettings',
      );
      render(
        <RagStatusBadge
          status="failed"
          error='Organization "test" has no embedding model configured…'
          errorCode="embedding_not_configured"
          documentId="doc-1"
        />,
      );
      openFailedDialog();
      expect(
        screen.getByText(
          'documents.rag.dialog.failed.embeddingNotConfigured.askAdmin',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('renders no guidance for failures without the code', () => {
      render(
        <RagStatusBadge status="failed" error="boom" documentId="doc-1" />,
      );
      openFailedDialog();
      expect(
        screen.queryByText(
          'documents.rag.dialog.failed.embeddingNotConfigured.hint',
        ),
      ).not.toBeInTheDocument();
    });

    it('passes axe audit with the guidance shown', async () => {
      render(
        <RagStatusBadge
          status="failed"
          error="no embedding model"
          errorCode="embedding_not_configured"
          documentId="doc-1"
        />,
      );
      openFailedDialog();
      // The dialog is portaled outside the render container.
      await checkAccessibility(document.body);
    });
  });
});
