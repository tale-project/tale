import { Row } from '@tale/ui/layout';
import { SkeletonBox, SkeletonCircle } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

/**
 * KEEP THIS MODULE LEAN. The boot-shell prerender script renders it under
 * plain `bun` at build time (via DashboardShellFrame) — imports must stay
 * framework-free: @tale/ui layout/skeleton primitives and static markup only.
 */

/**
 * Masked stand-in for the chat composer, shown before the chat route can
 * mount the real one: baked into the served boot shell and rendered by the
 * dashboard layout while access resolves. Mirrors the real composer's frame
 * (centered `max-w-3xl` bordered box: field area, then a controls row of
 * pickers leading and dictation + send trailing) so the live composer slots
 * in without reflow.
 *
 * Whether it shows is decided entirely in CSS by the `boot-chat` class on
 * `<html>`, set by the pre-hydration script in `index.html` when the
 * navigation targets a chat route (or an org root, which always redirects to
 * chat) — same contract as ChatSubPanelPlaceholder, minus the panel-open
 * condition: the composer is part of every chat layout.
 */
export function ChatComposerPlaceholder() {
  return (
    <div className="mt-auto hidden shrink-0 px-4 pb-4 [.boot-chat_&]:block">
      <div className="border-border sm:border-muted-foreground/50 bg-background mx-auto w-full max-w-3xl rounded-xl border px-3 pt-3 sm:rounded-2xl sm:px-5 sm:pt-4">
        <Skeletonize loading>
          <div className="min-h-[72px] sm:min-h-[100px]">
            <SkeletonBox>
              <div className="h-4 w-44" />
            </SkeletonBox>
          </div>
          <Row gap={2} justify="between" align="center" className="pb-3">
            <Row gap={1} align="center">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonBox key={`control-${i}`}>
                  <div className="h-7 w-16 rounded-md" />
                </SkeletonBox>
              ))}
            </Row>
            <Row gap={1} align="center">
              <SkeletonCircle>
                <div className="size-8" />
              </SkeletonCircle>
              <SkeletonCircle>
                <div className="size-8" />
              </SkeletonCircle>
            </Row>
          </Row>
        </Skeletonize>
      </div>
    </div>
  );
}
