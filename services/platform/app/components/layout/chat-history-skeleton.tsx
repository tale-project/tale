import { Row, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

/**
 * KEEP THIS MODULE LEAN. The boot-shell prerender script renders it under
 * plain `bun` (via ChatSubPanelPlaceholder) — imports must stay
 * framework-free (@tale/ui layout/skeleton primitives only).
 */

/**
 * Masked stand-in for the project/chat history lists — one geometry shared by
 * ChatHistorySidebar's loading state and the boot-shell/access-resolving
 * ChatSubPanelPlaceholder, so the reveal is a mask swap, not a layout change.
 * Mirrors the loaded sidebar: PROJECTS header + folder rows, divider, CHATS
 * header + chat rows. The varied label widths live on plain flex-item
 * wrappers (a % width resolves against the row there), with a `fullWidth`
 * box filling each wrapper — a % width on the hidden placeholder itself
 * would either collapse to 0 (non-fullWidth) or be ignored by the mask
 * (fullWidth).
 */
export function ChatHistorySkeleton() {
  return (
    <Skeletonize loading>
      <Stack gap={0} className="gap-0.5 pb-2">
        <Row gap={0} className="h-7 px-2">
          <SkeletonBox>
            <div className="h-3 w-16" />
          </SkeletonBox>
        </Row>
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={`project-${i}`}
            className="flex h-8 items-center gap-1.5 px-2"
          >
            {/* Chevron + plain icon — matches the loaded folder row
                (chevron `size-3.5` + plain-variant icon `size-3`)
                instead of the legacy colored chip the skeleton used
                to suggest. */}
            <SkeletonBox>
              <div className="size-3.5 rounded-sm" />
            </SkeletonBox>
            <SkeletonBox>
              <div className="size-3 rounded-sm" />
            </SkeletonBox>
            <div style={{ width: `${58 - i * 14}%` }}>
              <SkeletonBox fullWidth>
                <div className="h-3.5" />
              </SkeletonBox>
            </div>
          </div>
        ))}
        <div aria-hidden className="border-border mt-1.5 mb-2 border-t" />
        <Row gap={0} className="h-7 px-2">
          <SkeletonBox>
            <div className="h-3 w-12" />
          </SkeletonBox>
        </Row>
        {Array.from({ length: 6 }).map((_, i) => (
          <Row key={`chat-${i}`} gap={0} className="h-8 px-2">
            <div style={{ width: `${82 - (i % 4) * 14}%` }}>
              <SkeletonBox fullWidth>
                <div className="h-3.5" />
              </SkeletonBox>
            </div>
          </Row>
        ))}
      </Stack>
    </Skeletonize>
  );
}
