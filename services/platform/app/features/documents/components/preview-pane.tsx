import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

import { cn } from '@/lib/utils/cn';

interface PreviewPaneProps {
  children: React.ReactNode;
  className?: string;
}

/** Light grey canvas for the preview/body column. */
export const previewPaneCanvasClasses = 'bg-muted p-6';

/** Plain text and markdown previews. */
export const previewPaneReadableClasses = previewPaneCanvasClasses;

/** DOCX/ODT — grey canvas with room for a centered white page. */
export const previewPaneDocumentClasses = 'bg-muted p-4';

export function PreviewPane({ children, className }: PreviewPaneProps) {
  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 w-full flex-1 flex-col overflow-auto',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Loading placeholder for any preview that renders inside `PreviewPane`.
 *
 * Renders the REAL `PreviewPane` shell (same muted surface, padding, and
 * `flex-1` footprint) with a centered document-shaped pulse inside, so the
 * lazy-loaded preview swaps in without the panel resizing or moving. Used both
 * as the `lazyComponent` Suspense fallback (chunk download) and while a
 * preview fetches its own content (PDF/DOCX/XLSX/text), so there is a single
 * stable surface across both phases — no `Center`+small-box → full-panel jump.
 */
export function PreviewPaneSkeleton() {
  return (
    <Skeletonize loading className="flex min-h-0 flex-1 flex-col">
      <PreviewPane className={previewPaneDocumentClasses}>
        <SkeletonBox>
          <div className="bg-background border-border/60 mx-auto aspect-[1/1.4] w-full max-w-2xl rounded-lg border shadow-sm" />
        </SkeletonBox>
      </PreviewPane>
    </Skeletonize>
  );
}
