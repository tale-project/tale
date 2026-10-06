import { lazyComponent } from '@tale/ui/lazy-component';
import type { ComponentProps } from 'react';

import type { DocumentPreviewDialog as DocumentPreviewDialogComponent } from './document-preview-dialog';

/**
 * The document preview for surfaces that load with the app — a chat's file
 * chips and source cards: it loads the first time a preview opens, with the
 * viewers and the documents' words it brings, not with every chat. Pointing
 * at what opens it starts the load (`warmDocumentPreviewDialog`).
 */
const loadDocumentPreviewDialog = () => import('./document-preview-dialog');

export const DocumentPreviewDialog = lazyComponent<
  ComponentProps<typeof DocumentPreviewDialogComponent>
>(() =>
  loadDocumentPreviewDialog().then((module) => ({
    default: module.DocumentPreviewDialog,
  })),
);

export function warmDocumentPreviewDialog(): void {
  loadDocumentPreviewDialog().catch((error: unknown) => {
    // Opening the preview loads it again, and says so if it still fails.
    console.warn('[documents] the preview did not load ahead', error);
  });
}
