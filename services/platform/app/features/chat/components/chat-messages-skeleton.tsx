'use client';

import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

/**
 * Placeholder rows that MIRROR the real message column's geometry. User turns
 * are right-aligned hugging bubbles; assistant turns are left-aligned prose,
 * inset by the same `px-4` the real bubble applies. The widths are the only
 * thing that varies row-to-row so the column reads like a real conversation.
 */
const PLACEHOLDER_ROWS: ReadonlyArray<
  | { role: 'user'; width: string }
  | { role: 'assistant'; lineWidths: readonly string[] }
> = [
  { role: 'user', width: 'w-44' },
  { role: 'assistant', lineWidths: ['w-full', 'w-11/12', 'w-3/4'] },
  { role: 'user', width: 'w-60' },
  { role: 'assistant', lineWidths: ['w-full', 'w-4/5'] },
];

/**
 * Message-column skeleton that mirrors the LOADED geometry of `ChatMessages`
 * (`mx-auto … max-w-(--chat-max-width) … gap-3 pt-6`, right/left aligned rows,
 * the bubble's `rounded-2xl px-4 py-3`). Shared by the cold-load Suspense
 * fallback AND the arena-exit window, so revealing the real list is a mask swap
 * with no layout shift.
 *
 * Every placeholder is a clean `SkeletonBox` (a solid rounded mask), NOT the
 * word-shaped `SkeletonText` — the latter read as a ragged, broken line here.
 * A user bubble masks as ONE bubble-shaped box (the real bubble is itself a
 * muted rounded rect, so a solid mask is faithful); an assistant turn masks as
 * a few tapering prose-line boxes, inset by `px-4` so they sit exactly where the
 * real rendered text sits. Widths live on wrappers AROUND each `fullWidth` box —
 * a width on the hidden placeholder inside a `fullWidth` box is ignored (the
 * mask fills the wrapper; see the SkeletonBox docs).
 */
export function ChatMessagesSkeleton() {
  const { t } = useT('chat');
  return (
    <Skeletonize loading label={t('skeleton.loadingMessage')}>
      <div className="mx-auto flex w-full max-w-(--chat-max-width) flex-col gap-3 pt-6">
        {PLACEHOLDER_ROWS.map((row, rowIdx) =>
          row.role === 'user' ? (
            <div
              // eslint-disable-next-line react/no-array-index-key
              key={rowIdx}
              className="flex justify-end"
            >
              {/* Hugging bubble, right-aligned. `h-11` matches a one-line user
                  bubble (text `leading-5` + `py-3`); the box's own rounding
                  stands in for the bubble's `rounded-2xl`. */}
              <div className={cn('max-w-xs lg:max-w-md', row.width)}>
                <SkeletonBox fullWidth>
                  <div className="h-11" />
                </SkeletonBox>
              </div>
            </div>
          ) : (
            <div
              // eslint-disable-next-line react/no-array-index-key
              key={rowIdx}
              className="flex justify-start"
            >
              {/* Full-width prose, inset by the bubble's px-4/py-3 so the masked
                  lines align with the real rendered answer. */}
              <div className="w-full px-4 py-3">
                <div className="flex flex-col gap-2">
                  {row.lineWidths.map((lineWidth, lineIdx) => (
                    <div
                      // eslint-disable-next-line react/no-array-index-key
                      key={lineIdx}
                      className={lineWidth}
                    >
                      <SkeletonBox fullWidth>
                        <div className="h-4" />
                      </SkeletonBox>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ),
        )}
      </div>
    </Skeletonize>
  );
}
