import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { forgetSavedLocale, saveLocale } from '@/tests/utils/lapsed-session';
import { act, cleanup, render, screen } from '@/tests/utils/render';

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

afterEach(async () => {
  cleanup();
  await forgetSavedLocale();
});

describe('DocumentPreviewDialog', () => {
  it.each([
    {
      locale: 'en',
      downloadName: 'Download file',
      closeName: 'Close preview',
      sidebarName: 'Document',
      indexedName: 'Document indexed',
      dialogName: 'Document preview',
    },
    {
      locale: 'de',
      downloadName: 'Datei herunterladen',
      closeName: 'Vorschau schließen',
      sidebarName: 'Dokument',
      indexedName: 'Dokument indexiert',
      dialogName: 'Dokumentvorschau',
    },
    {
      locale: 'fr',
      downloadName: 'Télécharger le fichier',
      closeName: "Fermer l'aperçu",
      sidebarName: 'Document',
      indexedName: 'Document indexé',
      dialogName: 'Aperçu du document',
    },
  ] as const)(
    'stacks the mobile header and metadata without changing desktop columns ($locale)',
    async ({
      locale,
      downloadName,
      closeName,
      sidebarName,
      indexedName,
      dialogName,
    }) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      mockDocument = {
        id: 'doc-1',
        name: 'folder-audit.txt',
        url: 'https://files.example/folder-audit.txt',
        ragStatus: 'completed',
      };
      const onOpenChange = vi.fn();
      const { user } = render(
        <QueryClientProvider client={new QueryClient()}>
          <DocumentPreviewDialog
            open
            onOpenChange={onOpenChange}
            documentId="doc-1"
          />
        </QueryClientProvider>,
      );
      const title = screen.getByText('folder-audit.txt');
      const download = screen.getByRole('button', { name: downloadName });
      const close = screen.getByRole('button', { name: closeName });
      const header = download.parentElement?.parentElement;
      expect(header).toHaveClass(
        'grid-cols-1',
        'md:grid-cols-[minmax(0,1fr)_260px]',
      );
      expect(header).not.toHaveClass('grid-cols-[minmax(0,1fr)_260px]');
      expect(header).toContainElement(title);
      expect(title).toHaveClass('break-words', 'md:truncate');
      expect(title).not.toHaveClass('truncate');

      const sidebar = screen.getByRole('complementary', { name: sidebarName });
      const sidebarPanel = sidebar.parentElement;
      const body = sidebarPanel?.parentElement;
      expect(body).toHaveClass(
        'flex-col',
        'overflow-y-auto',
        'md:grid',
        'md:overflow-hidden',
        'md:grid-cols-[minmax(0,1fr)_260px]',
      );
      expect(body).not.toHaveClass('grid-cols-[minmax(0,1fr)_260px]');
      expect(body?.firstElementChild).toHaveClass(
        'h-[60vh]',
        'shrink-0',
        'md:h-auto',
        'min-h-0',
      );
      expect(sidebarPanel).toHaveClass(
        'shrink-0',
        'md:h-full',
        'md:overflow-y-auto',
      );
      expect(sidebarPanel).not.toHaveClass('h-full', 'overflow-y-auto');

      act(() => download.focus());
      await user.tab();
      expect(close).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: indexedName })).toHaveFocus();
      await checkAccessibility(
        screen.getByRole('dialog', { name: dialogName }),
      );
      await user.click(close);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    },
    15_000,
  );

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
