import { Row, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

/**
 * KEEP THIS MODULE LEAN. The boot-shell prerender script renders it under
 * plain `bun` (via HomePanelPlaceholder) — imports must stay framework-free
 * (@tale/ui layout/skeleton primitives only).
 */

/**
 * Masked project rows — the geometry of the Home panel's loaded project rows
 * (a 16px avatar + label in an `h-8` row), shared by the full panel skeleton
 * below and the PROJECTS section while only the project read is answering.
 * The varied label widths live on plain flex-item wrappers (a % width
 * resolves against the row there), with a `fullWidth` box filling each
 * wrapper — a % width on the hidden placeholder itself would either collapse
 * to 0 (non-fullWidth) or be ignored by the mask (fullWidth).
 */
export function ProjectRowsSkeleton() {
  return (
    <>
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          key={`project-${i}`}
          className="flex h-8 shrink-0 items-center gap-2 px-2"
        >
          <SkeletonBox>
            <div className="size-4 rounded" />
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
 * Masked Home rows — the two-line geometry every Home row shares (a 20px
 * glyph, a title line and a context line), shared by the full panel skeleton
 * below and the stream / Inbox list while their reads answer.
 */
export function HomeRowsSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <Row
          key={`row-${i}`}
          gap={0}
          className="shrink-0 items-start gap-2.5 px-2 py-1.5"
        >
          <SkeletonBox>
            <div className="mt-0.5 size-5 rounded-full" />
          </SkeletonBox>
          <Stack gap={0} className="min-w-0 flex-1 gap-1.5 py-0.5">
            <div style={{ width: `${82 - (i % 4) * 14}%` }}>
              <SkeletonBox fullWidth>
                <div className="h-3.5" />
              </SkeletonBox>
            </div>
            <div style={{ width: `${46 - (i % 3) * 8}%` }}>
              <SkeletonBox fullWidth>
                <div className="h-3" />
              </SkeletonBox>
            </div>
          </Stack>
        </Row>
      ))}
    </>
  );
}

/**
 * Masked single-line chat rows — the archived drawer's rows, which keep the
 * compact chat-row geometry.
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
 * Masked stand-in for the WHOLE Home panel — one geometry shared by the
 * boot-shell / access-resolving HomePanelPlaceholder, so the reveal is a
 * mask swap, not a layout change. Mirrors the loaded panel: the `h-13`
 * header, the view switcher, the PROJECTS header and rows, then a day
 * header and the two-line rows. Once the real panel mounts, its fixed parts
 * render real text immediately and only the still-answering sections keep
 * their rows masked (the pieces above).
 */
export function HomePanelSkeleton() {
  return (
    <Skeletonize loading>
      <Stack gap={0}>
        <Row
          gap={0}
          className="border-border h-13 shrink-0 justify-between border-b pr-2.5 pl-4"
        >
          <SkeletonBox>
            <div className="h-4 w-14" />
          </SkeletonBox>
          <SkeletonBox>
            <div className="size-5 rounded-md" />
          </SkeletonBox>
        </Row>
        <div className="px-2.5 pt-2.5 pb-2">
          <SkeletonBox fullWidth>
            <div className="h-8 rounded-lg" />
          </SkeletonBox>
        </div>
        <Stack gap={0} className="gap-0.5 px-2.5">
          <Row gap={0} className="h-7 px-2">
            <SkeletonBox>
              <div className="h-3 w-16" />
            </SkeletonBox>
          </Row>
          <ProjectRowsSkeleton />
          <div aria-hidden className="border-border/70 mt-2 border-t" />
          <Row gap={0} className="h-7 px-2 pt-2">
            <SkeletonBox>
              <div className="h-3 w-12" />
            </SkeletonBox>
          </Row>
          <HomeRowsSkeleton />
        </Stack>
      </Stack>
    </Skeletonize>
  );
}
