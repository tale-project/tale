'use client';

import { Row, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Tabs } from '@tale/ui/tabs';
import { ChevronRight } from 'lucide-react';

import { ContentArea } from '@/app/components/layout/content-area';
import { useT } from '@/lib/i18n/client';

import { TASK_STATUS_ORDER } from '../lib/display';
import type { TaskView } from '../lib/view';
import { TaskStatusBadge } from './task-status-badge';

/** One masked task-card placeholder mirroring the real card's footprint
 *  (identifier line · title · footer glyph row). */
function TaskCardSkeleton({ titleWidth }: { titleWidth: string }) {
  return (
    <div className="border-border bg-card rounded-lg border p-3 shadow-sm">
      <SkeletonBox>
        <div className="h-3 w-12" />
      </SkeletonBox>
      <div className="mt-1.5" style={{ width: titleWidth }}>
        <SkeletonBox fullWidth>
          <div className="h-3.5" />
        </SkeletonBox>
      </div>
      <Row gap={0} justify="between" className="mt-3">
        <SkeletonBox>
          <div className="h-3.5 w-10" />
        </SkeletonBox>
        <SkeletonBox>
          <div className="size-6 rounded-full" />
        </SkeletonBox>
      </Row>
    </div>
  );
}

/**
 * First-load placeholder that fills the same `min-h-0 flex-1` slot as the real
 * board/list. It mirrors the loaded structure exactly — every status lane /
 * section renders (with its real status badge) holding 5 masked placeholder
 * rows — so the reveal is an in-place mask swap with no layout shift.
 *
 * Kept in its own (eagerly importable) module so the per-view ROUTE files can
 * render the exact same skeleton as their lazy-chunk fallback: navigation →
 * chunk load → data load is one continuous skeleton.
 */
export function TasksSkeleton({ view }: { view: TaskView }) {
  if (view === 'board') {
    return (
      <Skeletonize loading>
        <Row
          gap={3}
          align="stretch"
          className="min-h-0 flex-1 overflow-hidden px-0.5 pb-4"
        >
          {TASK_STATUS_ORDER.map((status, col) => (
            <Stack
              key={status}
              as="section"
              gap={0}
              className="bg-muted/40 w-[80vw] max-w-72 shrink-0 rounded-lg sm:w-72"
            >
              <Row gap={2} justify="between" className="px-2.5 py-2">
                <TaskStatusBadge status={status} />
                <SkeletonBox>
                  <div className="h-3.5 w-4" />
                </SkeletonBox>
              </Row>
              <Stack gap={2} className="overflow-hidden px-2 pt-0.5 pb-2">
                {Array.from({ length: 5 }).map((_, card) => (
                  <TaskCardSkeleton
                    key={card}
                    titleWidth={`${55 + (((col + card) * 17) % 36)}%`}
                  />
                ))}
              </Stack>
            </Stack>
          ))}
        </Row>
      </Skeletonize>
    );
  }
  return (
    <Skeletonize loading>
      <div className="min-h-0 flex-1 overflow-hidden">
        {TASK_STATUS_ORDER.map((status, section) => (
          <section key={status}>
            <Row gap={2} className="bg-background px-3 py-1.5">
              <span className="text-muted-foreground -ml-1 flex items-center gap-2 p-1">
                <ChevronRight
                  className="size-3.5 shrink-0 rotate-90"
                  aria-hidden="true"
                />
                <TaskStatusBadge status={status} />
                <SkeletonBox>
                  <div className="h-3.5 w-4" />
                </SkeletonBox>
              </span>
            </Row>
            {Array.from({ length: 5 }).map((_, row) => (
              <div
                key={row}
                className="border-border/60 flex items-center gap-2.5 border-b py-1.5 pr-3 pl-9"
              >
                <SkeletonBox>
                  <div className="size-3.5 rounded" />
                </SkeletonBox>
                <SkeletonBox>
                  <div className="hidden h-3.5 w-14 sm:block" />
                </SkeletonBox>
                <div className="min-w-0 flex-1">
                  <div
                    className="max-w-xs"
                    style={{ width: `${42 + (((section + row) * 19) % 31)}%` }}
                  >
                    <SkeletonBox fullWidth>
                      <div className="h-3.5" />
                    </SkeletonBox>
                  </div>
                </div>
                <SkeletonBox>
                  <div className="size-6 rounded-full" />
                </SkeletonBox>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Skeletonize>
  );
}

/**
 * Whole-page placeholder for the lazy TasksWorkspace chunk, inside the same
 * ContentArea frame the workspace renders. The Board/List view pills render
 * REAL (with the route's view selected) — their shape is static, so masking
 * them would only add skeleton noise; they become interactive the moment the
 * chunk mounts. Only the genuinely dynamic toolbar actions are masked, above
 * the view-matched body skeleton. Because each per-view route knows its view
 * statically, the chunk fallback and the in-workspace first-load skeleton
 * are pixel-identical — no generic-text flash, no layout shift on reveal.
 */
export function TasksPageSkeleton({ view }: { view: TaskView }) {
  const { t } = useT('tasks');
  return (
    <ContentArea gap={4} className="flex h-full flex-col py-4">
      <Row gap={3} justify="between">
        <Tabs
          variant="pill"
          value={view}
          items={[
            { value: 'board', label: t('views.board') },
            { value: 'list', label: t('views.list') },
          ]}
        />
        <Skeletonize loading>
          <Row gap={2}>
            <SkeletonBox>
              <div className="h-8 w-24 rounded-md" />
            </SkeletonBox>
            <SkeletonBox>
              <div className="h-8 w-20 rounded-md" />
            </SkeletonBox>
          </Row>
        </Skeletonize>
      </Row>
      <TasksSkeleton view={view} />
    </ContentArea>
  );
}
