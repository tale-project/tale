'use client';

import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

const PLACEHOLDER_MESSAGE_ROWS: Array<
  | { role: 'user'; width: string }
  | { role: 'assistant'; lines: number; lastLineWidth: string }
> = [
  { role: 'user', width: 'w-40' },
  { role: 'assistant', lines: 3, lastLineWidth: '66%' },
  { role: 'user', width: 'w-56' },
  { role: 'assistant', lines: 2, lastLineWidth: '82%' },
];

/**
 * Message-column skeleton that mirrors `ChatMessages`' loaded geometry
 * (`mx-auto … max-w-(--chat-max-width) … gap-3 pt-6` with right/left aligned
 * placeholder rows). Shared by the arena-exit window AND the cold-load
 * Suspense fallback so revealing the real list is a mask swap with no layout
 * shift.
 *
 * Granularity matters here: user turns mask as one hugging bubble-shaped box,
 * assistant turns mask as word-shaped prose lines (`SkeletonText`) instead of
 * solid full-width bars. The widths live on wrappers around the boxes — a
 * width on the hidden placeholder inside a `fullWidth` box would be ignored
 * (the mask fills the wrapper; see the SkeletonBox docs).
 */
export function ChatMessagesSkeleton() {
  const { t } = useT('chat');
  return (
    <Skeletonize loading label={t('skeleton.loadingMessage')}>
      <div className="mx-auto flex w-full max-w-(--chat-max-width) flex-col gap-3 pt-6">
        {PLACEHOLDER_MESSAGE_ROWS.map((row, rowIdx) => (
          <div
            // eslint-disable-next-line react/no-array-index-key
            key={rowIdx}
            className={cn(
              'flex flex-col',
              row.role === 'user' ? 'items-end' : 'items-start',
            )}
          >
            {row.role === 'user' ? (
              <div className={cn('max-w-full', row.width)}>
                <SkeletonBox fullWidth>
                  <div className="h-9 rounded-xl" />
                </SkeletonBox>
              </div>
            ) : (
              <div className="w-full text-sm">
                <SkeletonText
                  lines={row.lines}
                  lastLineWidth={row.lastLineWidth}
                  seed={rowIdx}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </Skeletonize>
  );
}
