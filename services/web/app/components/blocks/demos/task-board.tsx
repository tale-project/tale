import { DemoShell } from '@tale/marketing-ui/demo-shell';
import { useDemoTimeline } from '@tale/marketing-ui/use-demo-timeline';
import { cn } from '@tale/ui/cn';
import { cva } from 'class-variance-authority';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import {
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  UserRound,
} from 'lucide-react';
import { useRef, type ReactNode } from 'react';

import {
  type TaskBoardCard,
  type TaskBoardScenario,
  useTaskBoardScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

const laneStyle = cva('flex min-w-0 flex-1 flex-col rounded-xl border', {
  variants: {
    status: {
      todo: 'border-border-base bg-surface-site-inset/60',
      in_progress: 'border-demo-sky/20 bg-demo-sky-soft',
      in_review: 'border-demo-violet/20 bg-demo-violet-soft',
      done: 'border-demo-mint/20 bg-demo-mint-soft',
    },
  },
});
const STATUS_ICON = {
  todo: CircleDashed,
  in_progress: CircleDot,
  in_review: Circle,
  done: CircleCheck,
} as const;

const BEATS = [0, 300, 700, 1100, 1500, 1900, 2400] as const;
const BEAT = {
  frame: 0,
  columns: 1,
  todo: 2,
  inProgress: 3,
  inReview: 4,
  done: 5,
  working: 6,
} as const;

/**
 * D8 — Projects task board (kanban). Mirrors `KanbanBoard` /
 * `BoardColumn` / `TaskCard` idioms: status lanes, identifier + title cards,
 * assignee row. Product also has Backlog + Cancelled — omitted here so
 * the fixed marketing frame stays readable (see `BOARD_TASK_STATUSES`).
 */
export function TaskBoard({
  scenario,
  elevation = 'default',
}: {
  /** Story override — defaults to the homepage relaunch board. */
  scenario?: TaskBoardScenario;
  elevation?: 'default' | 'hero';
}) {
  const { t } = useT('home');
  const homeScenario = useTaskBoardScenario();
  const scene = scenario ?? homeScenario;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15%' });
  const beat = useDemoTimeline({
    beats: BEATS,
    start: elevation === 'hero' || inView,
  });
  const reduceMotion = useReducedMotion();

  const columns: readonly {
    key: keyof typeof STATUS_ICON;
    label: string;
    cards: readonly TaskBoardCard[];
    showAt: number;
    working?: boolean;
  }[] = [
    {
      key: 'todo',
      label: t('demos.tasks.colTodo'),
      cards: scene.todo,
      showAt: BEAT.todo,
    },
    {
      key: 'in_progress',
      label: t('demos.tasks.colInProgress'),
      cards: [scene.inProgress],
      showAt: BEAT.inProgress,
      working: true,
    },
    {
      key: 'in_review',
      label: t('demos.tasks.colInReview'),
      cards: [scene.inReview],
      showAt: BEAT.inReview,
    },
    {
      key: 'done',
      label: t('demos.tasks.colDone'),
      cards: [scene.done],
      showAt: BEAT.done,
    },
  ];

  return (
    <div ref={ref}>
      <DemoShell
        label={scene.label}
        elevation={elevation}
        title={t('demos.tasks.windowTitle')}
        activeNav="projects"
        className="mx-auto min-h-184 max-w-4xl @sm/demo:min-h-160 @4xl/demo:aspect-[16/10] @4xl/demo:min-h-136"
      >
        <div className="demo-surface flex h-full flex-col gap-3 p-2 @sm/demo:p-3 @2xl/demo:gap-4 @2xl/demo:p-4">
          {beat >= BEAT.columns ? (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: easeOut }}
              className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[1.6fr_1fr_1fr_1fr] gap-2 @sm/demo:grid-cols-2 @sm/demo:grid-rows-2 @2xl/demo:gap-3 @4xl/demo:grid-cols-4 @4xl/demo:grid-rows-1"
            >
              {columns.map((column) => {
                const working = Boolean(column.working) && beat >= BEAT.working;
                const StatusIcon = STATUS_ICON[column.key];
                return (
                  <section
                    key={column.key}
                    className={laneStyle({ status: column.key })}
                  >
                    <header className="flex items-start justify-between gap-1 px-1.5 py-1.5 @sm/demo:px-2 @2xl/demo:px-2.5 @2xl/demo:py-2">
                      <span className="text-fg-base flex min-w-0 items-start gap-1 text-[10px] font-medium tracking-wide wrap-anywhere uppercase @2xl/demo:text-[11px]">
                        <StatusIcon
                          className="mt-px size-3 shrink-0 opacity-65"
                          strokeWidth={1.75}
                        />
                        <span className="min-w-0">{column.label}</span>
                      </span>
                      <span className="text-fg-subtle text-[10px] tabular-nums @2xl/demo:text-[11px]">
                        {column.cards.length}
                      </span>
                    </header>
                    <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-1 pb-2 @sm/demo:px-1.5 @2xl/demo:gap-2 @2xl/demo:px-2">
                      {beat >= column.showAt ? (
                        column.cards.map((card, index) => (
                          <motion.article
                            key={card.id}
                            initial={
                              reduceMotion ? false : { opacity: 0, y: 6 }
                            }
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                              duration: 0.3,
                              ease: easeOut,
                              delay: reduceMotion ? 0 : index * 0.05,
                            }}
                            className={cn(
                              'border-border-base/80 bg-surface-site-raised rounded-lg border p-1.5 shadow-sm @sm/demo:p-2 @2xl/demo:p-2.5',
                              working && 'ring-demo-sky/30 ring-1',
                            )}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-1">
                              <p className="text-fg-subtle text-[10px] font-medium tracking-wide tabular-nums">
                                {card.id}
                              </p>
                              {working ? (
                                <span className="bg-demo-sky-soft text-demo-sky shrink-0 rounded px-1 py-0.5 text-[9px] font-medium tracking-wide uppercase">
                                  {t('demos.tasks.working')}
                                </span>
                              ) : null}
                            </div>
                            <p className="text-fg-base mt-0.5 text-[11px] leading-snug font-medium wrap-anywhere hyphens-auto @2xl/demo:text-xs">
                              {card.title}
                            </p>
                            <p className="text-fg-muted mt-1.5 flex min-w-0 items-start gap-1 text-[10px] @2xl/demo:text-[11px]">
                              <span className="demo-soft demo-accent flex size-4 shrink-0 items-center justify-center rounded-full">
                                <UserRound
                                  className="size-2.5"
                                  strokeWidth={1.75}
                                />
                              </span>
                              <span className="min-w-0 wrap-anywhere">
                                {card.assignee}
                              </span>
                            </p>
                          </motion.article>
                        ))
                      ) : (
                        <EmptyLane />
                      )}
                    </div>
                  </section>
                );
              })}
            </motion.div>
          ) : null}
        </div>
      </DemoShell>
    </div>
  );
}

function EmptyLane(): ReactNode {
  return (
    <div className="border-border-base/80 text-fg-subtle m-0.5 flex flex-1 items-center justify-center rounded-lg border border-dashed px-2 py-4 text-[10px]">
      ···
    </div>
  );
}
