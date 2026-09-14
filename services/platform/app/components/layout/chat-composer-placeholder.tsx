import { Row, Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonCircle } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

import {
  CHAT_COMPOSER_FIELD_CLASS,
  CHAT_COMPOSER_FRAME_CLASS,
} from '../../features/chat/lib/layout';

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
      <Skeletonize loading className="mx-auto w-full max-w-3xl">
        <Stack gap={2} className={CHAT_COMPOSER_FRAME_CLASS}>
          <div className={CHAT_COMPOSER_FIELD_CLASS}>
            <SkeletonBox asChild>
              <div className="h-5 w-44 rounded-md" />
            </SkeletonBox>
          </div>
          <Row
            gap={2}
            justify="between"
            align="center"
            className="min-w-0 pb-3 sm:gap-4"
          >
            <Row
              gap={1}
              align="center"
              className="min-w-0 flex-1 overflow-hidden"
            >
              <SkeletonBox asChild>
                <div className="size-9 shrink-0 rounded-lg" />
              </SkeletonBox>
              <SkeletonBox asChild>
                <div className="h-8 w-24 rounded-lg" />
              </SkeletonBox>
            </Row>
            <Row gap={1} align="center" className="shrink-0">
              {Array.from({ length: 3 }).map((_, index) => (
                <SkeletonCircle key={index} asChild>
                  <div className="size-9 rounded-full" />
                </SkeletonCircle>
              ))}
            </Row>
          </Row>
        </Stack>
      </Skeletonize>
    </div>
  );
}
