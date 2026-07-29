import { Row, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

/**
 * KEEP THIS MODULE LEAN. The boot-shell prerender script renders it under
 * plain `bun` (via ChatSubPanelPlaceholder) — imports must stay
 * framework-free (@tale/ui layout/skeleton primitives only).
 */

/**
 * Masked project-folder rows — the row geometry of ThreadList's loaded
 * folders (chevron `size-3.5` + plain-variant icon `size-3` + label), shared
 * by the full panel skeleton below and ThreadList's own PROJECTS section
 * while only the project read is still answering. The varied label widths
 * live on plain flex-item wrappers (a % width resolves against the row
 * there), with a `fullWidth` box filling each wrapper — a % width on the
 * hidden placeholder itself would either collapse to 0 (non-fullWidth) or be
 * ignored by the mask (fullWidth).
 */
export function ProjectRowsSkeleton() {
  return (
    <>
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          key={`project-${i}`}
          className="flex h-8 shrink-0 items-center gap-1.5 px-2"
        >
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
    </>
  );
}

/**
 * Masked chat rows — the row geometry of ThreadList's loaded thread rows,
 * shared by the full panel skeleton below and ThreadList's own CHATS section
 * while only the thread read is still answering.
 */
export function ChatRowsSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <Row key={`chat-${i}`} gap={0} className="h-8 shrink-0 px-2">
          <div style={{ width: `${82 - (i % 4) * 14}%` }}>
            <SkeletonBox fullWidth>
              <div className="h-3.5" />
            </SkeletonBox>
          </div>
        </Row>
      ))}
    </>
  );
}

/**
 * Masked stand-in for the WHOLE project/chat history panel — one geometry
 * shared by the boot-shell/access-resolving ChatSubPanelPlaceholder, so the
 * reveal is a mask swap, not a layout change. Mirrors the loaded sidebar:
 * PROJECTS header + folder rows, divider, CHATS header + chat rows. Once the
 * real ThreadList mounts, its section HEADERS render real text immediately
 * and only the still-answering section keeps its rows masked (the pieces
 * above), so the panel loads in granularly instead of holding one big mask.
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
        <ProjectRowsSkeleton />
        <div aria-hidden className="border-border mt-1.5 mb-2 border-t" />
        <Row gap={0} className="h-7 px-2">
          <SkeletonBox>
            <div className="h-3 w-12" />
          </SkeletonBox>
        </Row>
        <ChatRowsSkeleton />
      </Stack>
    </Skeletonize>
  );
}
