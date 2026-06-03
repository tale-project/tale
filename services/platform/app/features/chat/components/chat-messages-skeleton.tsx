'use client';

import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

const PLACEHOLDER_MESSAGE_ROWS: Array<{
  role: 'user' | 'assistant';
  widths: string[];
}> = [
  { role: 'user', widths: ['w-40'] },
  { role: 'assistant', widths: ['w-full', 'w-5/6', 'w-2/3'] },
  { role: 'user', widths: ['w-56'] },
  { role: 'assistant', widths: ['w-full', 'w-4/5'] },
];

/**
 * Message-column skeleton that mirrors `ChatMessages`' loaded geometry
 * (`mx-auto … max-w-(--chat-max-width) … gap-3 pt-6` with right/left aligned
 * placeholder bubbles). Shared by the arena-exit window AND the cold-load
 * Suspense fallback so revealing the real list is a mask swap with no layout
 * shift — previously the cold fallback was a generic top-left `SkeletonText`
 * whose geometry didn't match the centered message column.
 */
export function ChatMessagesSkeleton() {
  const { t } = useT('chat');
  return (
    <Skeletonize loading label={t('skeleton.loadingMessage')}>
      <div className="mx-auto flex w-full max-w-(--chat-max-width) flex-col gap-3 pt-6">
        {PLACEHOLDER_MESSAGE_ROWS.map((row, rowIdx) => (
          <div
            key={rowIdx}
            className={cn(
              'flex flex-col gap-2',
              row.role === 'user' ? 'items-end' : 'items-start',
            )}
          >
            {row.widths.map((w, i) => (
              <SkeletonBox key={i} fullWidth>
                <div className={cn('h-4', w)} />
              </SkeletonBox>
            ))}
          </div>
        ))}
      </div>
    </Skeletonize>
  );
}
