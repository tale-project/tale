import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { Document } from '../hooks/queries';

let mockDocument: Partial<Document> | undefined;

// The dialog point-queries the document and resolves a storage URL; stub both
// so the component mounts without a live Convex backend. Returning no URL lands
// the body on the lightweight "failed to load" branch — enough to render the
// header, which is what this test inspects.
vi.mock('../hooks/queries', () => ({
  useDocument: () => ({ data: mockDocument, isLoading: false }),
}));
vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: () => ({ data: undefined, isLoading: false }),
}));
vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
// A document with a URL renders its file and the details sidebar; the file
// body has its own tests, and with no organization in scope the sidebar's
// team and legal-hold reads stay idle.
vi.mock('./document-preview', () => ({ DocumentPreview: () => null }));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => undefined,
}));

import { DocumentPreviewDialog } from './document-preview-dialog';

beforeEach(() => {
  mockDocument = undefined;
});

describe('DocumentPreviewDialog', () => {
  it('exposes the "Document preview" heading exactly once', () => {
    render(
      <DocumentPreviewDialog
        open
        onOpenChange={vi.fn()}
        fileId="storage123"
        fileName="report.pdf"
      />,
    );

    // The visible title and the dialog's accessible name share the same text;
    // only the (visually-hidden) DialogTitle should be a semantic heading, so
    // assistive tech hears "Document preview" once, not twice.
    expect(
      screen.getAllByRole('heading', { name: 'Document preview' }),
    ).toHaveLength(1);
  });

  // #3603: the badge read the backend's epoch-millisecond stamp as seconds,
  // and the sidebar's Indexed dialog dated the indexing in the year 58711.
  describe('indexing status', () => {
    // 10:00Z is 28 September from UTC−10 to UTC+13, whatever zone runs this.
    const indexedAt = Date.parse('2026-09-28T10:00:00.000Z');

    it.each([
      { ragIndexedAt: indexedAt, shows: 'September 28, 2026' },
      { ragIndexedAt: undefined, shows: 'Unknown' },
    ])(
      'shows $shows in the Indexed dialog',
      async ({ ragIndexedAt, shows }) => {
        mockDocument = {
          id: 'doc-1',
          name: 'report.pdf',
          url: 'https://files.example/report.pdf',
          ragStatus: 'completed',
          ragIndexedAt,
        };
        const { user } = render(
          // The RAG status badge holds its retry action, a react-query
          // mutation; the sidebar's reads are react-query too.
          <QueryClientProvider client={new QueryClient()}>
            <DocumentPreviewDialog
              open
              onOpenChange={vi.fn()}
              documentId="doc-1"
            />
          </QueryClientProvider>,
        );

        await user.click(
          screen.getByRole('button', { name: 'Document indexed' }),
        );
        const dialog = screen.getByRole('dialog', { name: 'Document indexed' });
        expect(dialog).toHaveTextContent(`Indexed on: ${shows}`);
        expect(dialog).not.toHaveTextContent('58711');
      },
    );
  });
});
