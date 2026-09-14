import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

import { cn } from '@/lib/utils/cn';

import { documentPageClasses } from './document-prose-classes';

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
 * `flex-1` footprint) with the format's own loading content. The chunk fallback
 * and the content fetch share one shape; document lengths and image/page
 * dimensions remain unknown until the file has loaded.
 */
export function PreviewPaneSkeleton({
  kind = 'document',
}: {
  kind?: PreviewSkeletonKind;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PreviewPane
        className={
          kind === 'document'
            ? previewPaneDocumentClasses
            : previewPaneCanvasClasses
        }
      >
        <PreviewContentSkeleton kind={kind} />
      </PreviewPane>
    </div>
  );
}

type PreviewSkeletonKind =
  | 'document'
  | 'text'
  | 'markdown'
  | 'spreadsheet'
  | 'image'
  | 'pdf';

/** Format-specific content shared by chunk and data-loading placeholders. */
export function PreviewContentSkeleton({
  kind,
  label,
}: {
  kind: PreviewSkeletonKind;
  label?: string;
}) {
  return (
    <Skeletonize loading label={label} className="contents">
      {kind === 'document' ? (
        <div className={documentPageClasses}>
          <div className="text-sm leading-relaxed">
            <SkeletonText lines={8} />
          </div>
        </div>
      ) : kind === 'spreadsheet' ? (
        <table
          aria-hidden="true"
          className="bg-background text-foreground w-full border-collapse"
        >
          <tbody>
            {Array.from({ length: 6 }, (_, row) => (
              <tr key={row}>
                {Array.from({ length: 4 }, (_cell, column) => (
                  <td
                    key={column}
                    className="border-border border px-3 py-2 align-top"
                  >
                    <SkeletonText seed={row * 4 + column} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : kind === 'image' || kind === 'pdf' ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <SkeletonBox asChild>
            <div
              className={
                kind === 'image'
                  ? 'size-64 max-h-full max-w-full rounded-xl'
                  : 'aspect-[1/1.4] h-full max-w-full rounded-sm'
              }
            />
          </SkeletonBox>
        </div>
      ) : (
        <div
          className={cn(
            'w-full text-sm',
            kind === 'text' && 'font-mono leading-relaxed',
          )}
        >
          <SkeletonText lines={8} />
        </div>
      )}
    </Skeletonize>
  );
}
