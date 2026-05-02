'use client';

import { Fragment, memo } from 'react';

import type { Hunk, HunkSegment } from './build-hunks';

/**
 * Render the canvas patch-stream view as a unified-diff-style flow of hunks
 * inside a single `<pre>` block, instead of materialising the whole artifact
 * source on every Convex push.
 *
 * Single-container layout (no per-hunk frame / border / header bar / inner
 * scrollbar): when there are multiple patches the user sees one continuous
 * monospace stream with thin `··· N-M ···` gutter lines between regions,
 * which reads like `git diff` rather than a stack of separate windows.
 *
 * Plain-text rendering (no Shiki) — same trade-off the prior `renderWithDiff`
 * made: Shiki HTML cannot host overlay marks without re-tokenising the entire
 * stream, and the user only stays in this view for the few-second stream
 * window plus the 10 s dwell. Settled view picks up syntax colour again.
 */

function SegmentRender({ segment }: { segment: HunkSegment }) {
  if (segment.kind === 'context') {
    return <>{segment.text}</>;
  }
  return (
    <>
      <del className="bg-destructive/15 text-destructive/90 decoration-destructive/60 rounded-sm decoration-2">
        {segment.search}
      </del>
      {segment.replace.length > 0 && (
        <ins className="bg-success/15 text-success-foreground rounded-sm px-0.5 no-underline">
          {segment.replace}
        </ins>
      )}
    </>
  );
}

function HunkSegmentsComponent({
  segments,
}: {
  segments: readonly HunkSegment[];
}) {
  return (
    <>
      {segments.map((segment, i) => (
        // Segment indices are stable across renders because patches' positions
        // in the source do not shift during a stream — only their `replace`
        // text grows.
        // eslint-disable-next-line react/no-array-index-key
        <SegmentRender key={i} segment={segment} />
      ))}
    </>
  );
}

const HunkSegments = memo(HunkSegmentsComponent);

function HunkSeparator({ hunk }: { hunk: Hunk }) {
  const range =
    hunk.startLine === hunk.endLine
      ? String(hunk.startLine)
      : `${hunk.startLine}–${hunk.endLine}`;
  return (
    <div
      className="text-muted-foreground/50 my-2 flex items-center gap-2 text-[10px] leading-none tabular-nums select-none"
      aria-hidden="true"
    >
      <span className="border-border/60 flex-1 border-t" />
      <span>{range}</span>
      <span className="border-border/60 flex-1 border-t" />
    </div>
  );
}

interface PatchHunkViewProps {
  hunks: readonly Hunk[];
}

function PatchHunkViewComponent({ hunks }: PatchHunkViewProps) {
  return (
    <pre
      className="bg-muted h-full overflow-auto p-4"
      aria-label="Patch preview"
      role="region"
    >
      <code className="text-xs leading-relaxed">
        {hunks.map((hunk) => (
          <Fragment key={`${hunk.startLine}-${hunk.endLine}`}>
            <HunkSeparator hunk={hunk} />
            <HunkSegments segments={hunk.segments} />
          </Fragment>
        ))}
      </code>
    </pre>
  );
}

export const PatchHunkView = memo(PatchHunkViewComponent);
