import { DialogErrorBoundary } from '@tale/ui/error-boundaries/dialog-error-boundary';
import { useT } from '@tale/ui/i18n/client';
import { lazyComponent } from '@tale/ui/lazy-component';
import { useRef, useState, type ComponentProps } from 'react';

import type { DocumentPreviewDialog as DocumentPreviewDialogComponent } from './document-preview-dialog';

/**
 * The document preview for surfaces that load with the app — a chat's file
 * chips and source cards: it loads the first time a preview opens, with the
 * viewers and the documents' words it brings, not with every chat. Pointing
 * at what opens it starts the load (`warmDocumentPreviewDialog`). A failed
 * load is contained by the dialog boundary so the surrounding surface stays.
 */
const loadDocumentPreviewDialog = () => import('./document-preview-dialog');

const createLazyDocumentPreviewDialog = () =>
  lazyComponent<ComponentProps<typeof DocumentPreviewDialogComponent>>(() =>
    loadDocumentPreviewDialog().then((module) => ({
      default: module.DocumentPreviewDialog,
    })),
  );

export function DocumentPreviewDialog(
  props: ComponentProps<typeof DocumentPreviewDialogComponent>,
) {
  const { t } = useT('documents');
  const containerRef = useRef<HTMLDivElement>(null);
  const [LazyDocumentPreviewDialog, setLazyDocumentPreviewDialog] = useState(
    createLazyDocumentPreviewDialog,
  );
  const description = t('preview.errors.errorLoadingDocumentPreview');

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="region"
      aria-label={t('preview.errors.documentPreview')}
    >
      <DialogErrorBoundary
        description={description}
        onError={() => containerRef.current?.focus()}
        onReset={() => {
          // React.lazy caches rejected promises; retry with a fresh instance.
          containerRef.current?.focus();
          setLazyDocumentPreviewDialog(() => createLazyDocumentPreviewDialog());
        }}
      >
        <LazyDocumentPreviewDialog {...props} />
      </DialogErrorBoundary>
    </div>
  );
}

export function warmDocumentPreviewDialog(): void {
  loadDocumentPreviewDialog().catch((error: unknown) => {
    // Report the warm-up failure; the boundary handles the render failure.
    console.warn('[documents] the preview did not load ahead', error);
  });
}
