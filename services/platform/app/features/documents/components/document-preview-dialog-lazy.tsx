import { DialogErrorBoundary } from '@tale/ui/error-boundaries/dialog-error-boundary';
import { lazyComponent } from '@tale/ui/lazy-component';
import type { ComponentProps } from 'react';

import type { DocumentPreviewDialog as DocumentPreviewDialogComponent } from './document-preview-dialog';

/**
 * The document preview for surfaces that load with the app — a chat's file
 * chips and source cards: it loads the first time a preview opens, with the
 * viewers and the documents' words it brings, not with every chat. Pointing
 * at what opens it starts the load (`warmDocumentPreviewDialog`). A failed
 * load is contained by the dialog boundary so the surrounding surface stays.
 */
const loadDocumentPreviewDialog = () => import('./document-preview-dialog');

const LazyDocumentPreviewDialog = lazyComponent<
  ComponentProps<typeof DocumentPreviewDialogComponent>
>(() =>
  loadDocumentPreviewDialog().then((module) => ({
    default: module.DocumentPreviewDialog,
  })),
);

export function DocumentPreviewDialog(
  props: ComponentProps<typeof DocumentPreviewDialogComponent>,
) {
  return (
    <DialogErrorBoundary>
      <LazyDocumentPreviewDialog {...props} />
    </DialogErrorBoundary>
  );
}

export function warmDocumentPreviewDialog(): void {
  loadDocumentPreviewDialog().catch((error: unknown) => {
    // Report the warm-up failure; the boundary handles the render failure.
    console.warn('[documents] the preview did not load ahead', error);
  });
}
