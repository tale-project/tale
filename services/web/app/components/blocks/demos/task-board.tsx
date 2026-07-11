import { cn } from '@tale/ui/cn';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { Bot } from 'lucide-react';
import { useRef, type ReactNode } from 'react';

import {
  type TaskBoardCard,
  type TaskBoardScenario,
  useTaskBoardScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { DemoShell } from '@/app/components/blocks/demos/demo-shell';
import { useDemoTimeline } from '@/app/components/blocks/demos/use-demo-timeline';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

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
 * agent assignee row. Product also has Backlog + Cancelled — omitted here so
 * the fixed marketing frame stays readable (see `BOARD_TASK_STATUSES`).
 */
export function TaskBoard({
  scenario,
}: {
  /** Story override — defaults to the homepage relaunch board. */
  scenario?: TaskBoardScenario;
}) {
  const { t } = useT('home');
  const homeScenario = useTaskBoardScenario();
  const scene = scenario ?? homeScenario;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15%' });
  const beat = useDemoTimeline({ beats: BEATS, start: inView });
  const reduceMotion = useReducedMotion();

  const columns: readonly {
    key: string;
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
        title={t('demos.tasks.windowTitle')}
        activeNav="projects"
        className="mx-auto aspect-[7/10] max-w-4xl sm:aspect-[16/10]"
      >
        <div className="flex h-full flex-col gap-3 p-3 md:gap-4 md:p-4">
          {beat >= BEAT.columns ? (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: easeOut }}
              className="flex min-h-0 flex-1 gap-2 overflow-hidden md:gap-3"
            >
              {columns.map((column) => {
                const working = Boolean(column.working) && beat >= BEAT.working;
                return (
                  <section
                    key={column.key}
                    className="bg-surface-site-inset/60 flex min-w-0 flex-1 flex-col rounded-lg"
                  >
                    <header className="flex items-center justify-between gap-1 px-2 py-1.5 md:px-2.5 md:py-2">
                      <span className="text-fg-base truncate text-[10px] font-medium tracking-wide uppercase md:text-[11px]">
                        {column.label}
                      </span>
                      <span className="text-fg-subtle text-[10px] tabular-nums md:text-[11px]">
                        {column.cards.length}
                      </span>
                    </header>
                    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden px-1.5 pb-2 md:gap-2 md:px-2">
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
                              'border-border-base bg-surface-site-raised rounded-md border p-2 shadow-sm md:p-2.5',
                              working && 'ring-border-strong ring-1',
                            )}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <p className="text-fg-subtle text-[10px] font-medium tracking-wide tabular-nums">
                                {card.id}
                              </p>
                              {working ? (
                                <span className="bg-surface-site-inset text-fg-muted shrink-0 rounded px-1 py-0.5 text-[9px] font-medium tracking-wide uppercase">
                                  {t('demos.tasks.working')}
                                </span>
                              ) : null}
                            </div>
                            <p className="text-fg-base mt-0.5 line-clamp-2 text-[11px] leading-snug font-medium md:text-xs">
                              {card.title}
                            </p>
                            <p className="text-fg-muted mt-1.5 flex min-w-0 items-center gap-1 text-[10px] md:text-[11px]">
                              <Bot
                                aria-hidden
                                className="size-3 shrink-0"
                                strokeWidth={1.75}
                              />
                              <span className="truncate">{card.assignee}</span>
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
