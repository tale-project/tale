'use client';

import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { cn } from '@tale/ui/cn';
import { ContentArea } from '@tale/ui/content-area';
import { DataTableFilters } from '@tale/ui/data-table/data-table-filters';
import { Row, Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonCircle, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Tabs } from '@tale/ui/tabs';
import { Text } from '@tale/ui/text';
import { ChevronRight, Plus } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { BOARD_TASK_STATUSES } from '../lib/display';
import type { TaskView } from '../lib/view';
import { TaskStatusBadge } from './task-status-badge';

/** One masked task-card placeholder mirroring the real card's footprint
 *  (identifier line · title · footer glyph row). */
function TaskCardSkeleton({
  titleWidth,
  canEdit,
}: {
  titleWidth: string;
  canEdit: boolean;
}) {
  return (
    <Card padding="sm" shadow="sm">
      <Row gap={1}>
        <Text
          as="span"
          variant="caption"
          className="w-12 font-mono text-[10px] tracking-wide"
        >
          <SkeletonText />
        </Text>
      </Row>
      <Text
        variant="label"
        className="leading-snug"
        style={{ width: titleWidth }}
      >
        <SkeletonText />
      </Text>
      <Row gap={2} justify="between" className="mt-3">
        <TaskPrioritySkeleton canEdit={canEdit} />
        <TaskAssigneeSkeleton canEdit={canEdit} />
      </Row>
    </Card>
  );
}

function TaskPrioritySkeleton({ canEdit }: { canEdit: boolean }) {
  return (
    <SkeletonBox asChild>
      <span className={cn('inline-flex shrink-0 rounded-md', canEdit && 'p-1')}>
        <span className="size-3.5" />
      </span>
    </SkeletonBox>
  );
}

function TaskAssigneeSkeleton({ canEdit }: { canEdit: boolean }) {
  return (
    <SkeletonCircle asChild>
      <span
        className={cn('inline-flex shrink-0 rounded-full', canEdit && 'p-1')}
      >
        <span className="size-5" />
      </span>
    </SkeletonCircle>
  );
}

/** Status labels are known before the task query answers. */
function StatusLabel({
  status,
}: {
  status: (typeof BOARD_TASK_STATUSES)[number];
}) {
  return (
    <Skeletonize loading={false} className="contents">
      <TaskStatusBadge status={status} />
    </Skeletonize>
  );
}

/**
 * First-load placeholder that fills the same `min-h-0 flex-1` slot as the real
 * board/list. Every status lane / section uses the live row geometry. Task
 * counts, wrapped titles and optional labels remain unknown until data loads.
 *
 * Kept in its own (eagerly importable) module so the per-view ROUTE files can
 * render the exact same skeleton as their lazy-chunk fallback: navigation →
 * chunk load → data load is one continuous skeleton.
 */
export function TasksSkeleton({
  view,
  canEdit = false,
}: {
  view: TaskView;
  canEdit?: boolean;
}) {
  if (view === 'board') {
    return (
      <Skeletonize loading className="flex min-h-0 flex-1 flex-col">
        <Row
          gap={3}
          align="stretch"
          className="min-h-0 flex-1 overflow-hidden px-0.5 pb-4"
        >
          {BOARD_TASK_STATUSES.map((status, col) => (
            <Stack
              key={status}
              as="section"
              gap={0}
              className="bg-muted/40 w-[80vw] max-w-72 shrink-0 rounded-lg sm:w-72"
            >
              <Row gap={2} justify="between" className="px-2.5 py-2">
                <StatusLabel status={status} />
                <Text
                  as="span"
                  variant="caption"
                  className="w-4 pr-1 tabular-nums"
                >
                  <SkeletonText />
                </Text>
              </Row>
              <Stack
                gap={2}
                className="min-h-24 flex-1 overflow-hidden px-2 pt-0.5 pb-2"
              >
                {Array.from({ length: 5 }).map((_, card) => (
                  <TaskCardSkeleton
                    key={card}
                    titleWidth={`${55 + (((col + card) * 17) % 36)}%`}
                    canEdit={canEdit}
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
    <Skeletonize loading className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        {BOARD_TASK_STATUSES.map((status, section) => (
          <section key={status}>
            <Row gap={2} className="bg-background px-3 py-1.5">
              <span className="text-muted-foreground -ml-1 flex items-center gap-2 p-1">
                <ChevronRight
                  className="size-3.5 shrink-0 rotate-90"
                  aria-hidden="true"
                />
                <StatusLabel status={status} />
                <Text as="span" variant="caption" className="w-4 tabular-nums">
                  <SkeletonText />
                </Text>
              </span>
            </Row>
            {Array.from({ length: 5 }).map((_, row) => (
              <div
                key={row}
                className="border-border/60 flex items-center gap-2.5 border-b py-1.5 pr-3 pl-9"
              >
                <TaskPrioritySkeleton canEdit={canEdit} />
                <Text
                  as="span"
                  variant="caption"
                  className="hidden w-14 shrink-0 font-mono text-[11px] tracking-wide sm:block"
                >
                  <SkeletonText />
                </Text>
                <div className="min-w-0 flex-1">
                  <div
                    className="max-w-xs text-sm"
                    style={{ width: `${42 + (((section + row) * 19) % 31)}%` }}
                  >
                    <SkeletonText />
                  </div>
                </div>
                <TaskAssigneeSkeleton canEdit={canEdit} />
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
export function TasksPageSkeleton({
  view,
  canEdit = false,
  allProjects = false,
}: {
  view: TaskView;
  canEdit?: boolean;
  allProjects?: boolean;
}) {
  const { t } = useT('tasks');
  return (
    <ContentArea gap={4} className="flex h-full flex-col">
      <Row gap={3} justify="between" wrap>
        <Row gap={2} wrap>
          <Tabs
            variant="pill"
            value={view}
            items={[
              { value: 'board', label: t('views.board') },
              { value: 'list', label: t('views.list') },
            ]}
          />
          <DataTableFilters
            search={{
              value: '',
              onChange: () => {},
              placeholder: t('searchPlaceholder'),
            }}
            filters={[
              {
                key: 'priority',
                title: t('fields.priority'),
                options: [],
                selectedValues: [],
                onChange: () => {},
              },
            ]}
            disabled
            className="w-auto"
          />
        </Row>
        <Skeletonize loading>
          <Row gap={2}>
            {canEdit && !allProjects && (
              <Button size="sm" icon={Plus}>
                {t('actions.create')}
              </Button>
            )}
          </Row>
        </Skeletonize>
      </Row>
      <TasksSkeleton view={view} canEdit={canEdit} />
    </ContentArea>
  );
}
