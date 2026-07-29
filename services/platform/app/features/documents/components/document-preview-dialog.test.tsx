import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// The dialog point-queries the document and resolves a storage URL; stub both
// so the component mounts without a live Convex backend. Returning no URL lands
// the body on the lightweight "failed to load" branch — enough to render the
// header, which is what this test inspects.
vi.mock('../hooks/queries', () => ({
  useDocument: () => ({ data: undefined, isLoading: false }),
}));
vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: () => ({ data: undefined, isLoading: false }),
}));
vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { DocumentPreviewDialog } from './document-preview-dialog';

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
});
