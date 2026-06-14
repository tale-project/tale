'use client';

import { Text } from '@tale/ui/text';
import { Upload } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface PageDropOverlayProps {
  /** Render the overlay (typically the `isDragOver` from `usePageFileDrop`). */
  show: boolean;
  /** Overrides the default "Drop files here" copy. */
  label?: string;
  className?: string;
}

/**
 * Full-viewport "drop files here" overlay for whole-page drag & drop. Paired
 * with `usePageFileDrop`. `pointer-events-none` is essential: the overlay must
 * NOT capture the drop — the window listener owns it — so it's purely visual.
 */
export function PageDropOverlay({
  show,
  label,
  className,
}: PageDropOverlayProps) {
  const { t } = useT('common');
  if (!show) return null;

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center gap-3',
        'bg-info/90 border-info-foreground border-2 border-dashed backdrop-blur-sm',
        className,
      )}
    >
      <Upload className="text-info-foreground size-10" aria-hidden />
      <Text as="span" className="text-info-foreground text-base font-medium">
        {label ?? t('upload.dropFilesHere')}
      </Text>
    </div>
  );
}
