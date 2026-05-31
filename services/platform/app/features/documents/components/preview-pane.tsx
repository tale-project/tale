import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

import { cn } from '@/lib/utils/cn';

interface PreviewPaneProps {
  children: React.ReactNode;
  className?: string;
}

export function PreviewPane({ children, className }: PreviewPaneProps) {
  return (
    <div
      className={cn(
        'relative mx-auto w-full flex flex-1 flex-col overflow-x-auto overflow-y-auto p-6 bg-muted rounded-lg min-h-0',
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
 * Renders the REAL `PreviewPane` shell (same `bg-muted rounded-lg`, padding,
 * and `flex-1` footprint) with a centered document-shaped pulse inside, so the
 * lazy-loaded preview swaps in without the panel resizing or moving. Used both
 * as the `lazyComponent` Suspense fallback (chunk download) and while a
 * preview fetches its own content (PDF/DOCX/XLSX/text), so there is a single
 * stable surface across both phases — no `Center`+small-box → full-panel jump.
 */
export function PreviewPaneSkeleton() {
  return (
    <Skeletonize loading className="contents">
      <PreviewPane>
        <SkeletonBox>
          <div className="mx-auto aspect-[1/1.4] w-full max-w-2xl" />
        </SkeletonBox>
      </PreviewPane>
    </Skeletonize>
  );
}
