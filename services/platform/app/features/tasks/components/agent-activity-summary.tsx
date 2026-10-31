'use client';

/**
 * How many agent runs are live in the project, apart from the status
 * columns (TASK-R87): a standing task's run works while the task stays in
 * To do, and an In progress card can have no run at all, so no column count
 * answers it. One entry per live run, never per task or agent, in three
 * kinds: running, waiting for input, queued.
 *
 * It reads the ops indicators the cards read, through their run states
 * (`readLiveRuns`), and words each run as its card does (`useTaskRunLine`).
 * It covers the whole project whatever the board's search, filters and cap
 * show, starts, cancels or reserves nothing, and never reads a read that
 * failed as no runs.
 */

import { formatTaskIdentifier } from '@tale/shared/utils/project-key';
import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import {
  DropdownMenu,
  type DropdownMenuGroup,
  type DropdownMenuItem,
} from '@tale/ui/dropdown-menu';
import { Bot } from 'lucide-react';
import { Fragment, useMemo } from 'react';

import type {
  TaskOpsAutomationWaitIndicator,
  TaskOpsRunIndicator,
} from '@/app/lib/backend/contract/tasks';
import { useT } from '@/lib/i18n/client';

import { type BoardReadState, readFailed } from '../lib/read-state';
import {
  type LiveRun,
  readLiveRuns,
  type RunActivity,
  runActivity,
} from './task-board-context';
import type { TaskRow } from './task-card';
import { TaskLiveLineView, useTaskRunLine } from './task-run-line';

const ACTIVITIES: readonly RunActivity[] = [
  'running',
  'waitingForInput',
  'queued',
];

interface AgentActivitySummaryProps {
  /** Where the project's ops read stands. */
  read: BoardReadState;
  runningTaskIds: readonly string[];
  askingTaskIds: readonly string[];
  runs: readonly TaskOpsRunIndicator[];
  automationWaits: readonly TaskOpsAutomationWaitIndicator[];
  /** The read lists fewer live runs than there are: each count is then a
   * lower bound. */
  partial: boolean;
  projectKey: string | null;
  /** The task as the board loaded it; undefined for one it doesn't show. */
  getTask: (taskId: string) => TaskRow | undefined;
  /** The run's agent by name, once the agents are known. */
  agentName: (agentId: string) => string | undefined;
  /** Open the task's sheet, where its runs are. */
  onOpenTask: (taskId: string) => void;
}

/** The live runs by what they do; a state the board can't place counts
 * nowhere. */
function byActivity(live: readonly LiveRun[]): Record<RunActivity, LiveRun[]> {
  const grouped: Record<RunActivity, LiveRun[]> = {
    running: [],
    waitingForInput: [],
    queued: [],
  };
  for (const run of live) {
    const activity = runActivity(run.state);
    if (activity !== undefined) grouped[activity].push(run);
  }
  return grouped;
}

export function AgentActivitySummary({
  read,
  runningTaskIds,
  askingTaskIds,
  runs,
  automationWaits,
  partial,
  projectKey,
  getTask,
  agentName,
  onOpenTask,
}: AgentActivitySummaryProps) {
  const { t } = useT('tasks');
  const runLine = useTaskRunLine();
  const grouped = useMemo(
    () =>
      byActivity(
        readLiveRuns({ runningTaskIds, askingTaskIds, runs, automationWaits }),
      ),
    [runningTaskIds, askingTaskIds, runs, automationWaits],
  );

  // Counts only from an answer that is current: a failed or out-of-date
  // read is unknown, never "none".
  const answered = read.kind === 'ready';
  const counted = answered
    ? ACTIVITIES.filter((activity) => grouped[activity].length > 0)
    : [];
  const countText = (activity: RunActivity) => {
    const count = grouped[activity].length;
    return partial
      ? t(`liveRuns.atLeast.${activity}`, { count })
      : t(`liveRuns.count.${activity}`, { count });
  };
  const parts = answered
    ? counted.length > 0
      ? counted.map(countText)
      : // A partial read always lists at least one run; were it to list
        // none, it still can't say there are none.
        [partial ? countText('running') : t('liveRuns.none')]
    : [readFailed(read) ? t('liveRuns.unavailable') : t('liveRuns.loading')];
  const working = answered && grouped.running.length > 0;

  const note = !answered
    ? readFailed(read)
      ? t('liveRuns.unavailableNote')
      : t('liveRuns.loadingNote')
    : partial
      ? t('liveRuns.partialNote')
      : counted.length === 0
        ? t('liveRuns.noneNote')
        : undefined;

  const runItem = (run: LiveRun): DropdownMenuItem => {
    const task = getTask(run.taskId);
    const identifier =
      task !== undefined
        ? formatTaskIdentifier(task.projectKey ?? projectKey, task.number)
        : null;
    const line = runLine(
      run.state,
      run.agentId !== undefined ? agentName(run.agentId) : undefined,
    );
    return {
      type: 'item',
      onClick: () => onOpenTask(run.taskId),
      label: (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="min-w-0 truncate">
            {identifier !== null && (
              <>
                <span className="text-muted-foreground tabular-nums">
                  {identifier}
                  <span className="sr-only">,</span>
                </span>{' '}
              </>
            )}
            {task !== undefined ? (
              task.title
            ) : (
              <span className="text-muted-foreground italic">
                {t('liveRuns.unlistedTask')}
              </span>
            )}
          </span>
          {line !== null && (
            <>
              <TaskLiveLineView line={line} />
              <span className="sr-only">, {line.text}</span>
            </>
          )}
        </span>
      ),
    };
  };

  const items = (): DropdownMenuGroup[] => {
    const groups: DropdownMenuGroup[] = [
      [
        { type: 'label', content: t('liveRuns.title') },
        {
          type: 'custom',
          content: (
            <div className="text-muted-foreground flex flex-col gap-1 px-2 pb-1.5 text-xs">
              <p>{t('liveRuns.scopeNote')}</p>
              {note !== undefined && <p>{note}</p>}
            </div>
          ),
        },
      ],
    ];
    // A group per kind of run, its runs in the order the read lists them.
    for (const activity of counted) {
      const group: DropdownMenuGroup = [
        {
          type: 'label',
          content: t(`liveRuns.groups.${activity}`),
          className: 'text-muted-foreground text-xs font-medium',
        },
      ];
      for (const run of grouped[activity]) group.push(runItem(run));
      groups.push(group);
    }
    return groups;
  };

  return (
    <DropdownMenu
      align="start"
      contentClassName="w-80"
      items={items}
      trigger={
        <Button
          variant="secondary"
          className="hover:bg-muted h-auto min-h-9 max-w-full justify-start gap-2 py-2 text-left leading-snug whitespace-normal"
        >
          <Bot
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0',
              working
                ? 'text-primary animate-pulse motion-reduce:animate-none'
                : 'text-muted-foreground',
            )}
          />
          <span>
            <span className="text-muted-foreground">{t('liveRuns.label')}</span>{' '}
            {parts.map((part, index) => (
              <Fragment key={part}>
                {/* The space sits between the parts, not at the end of
                    the hidden comma, where a name's whitespace is trimmed. */}
                {index > 0 && (
                  <>
                    <span aria-hidden="true"> ·</span>
                    <span className="sr-only">,</span>{' '}
                  </>
                )}
                <span className="whitespace-nowrap">{part}</span>
              </Fragment>
            ))}
            {/* Whose runs they are, said here to a screen reader after the
                counts the button shows; the menu says it to everyone. */}
            <span className="sr-only">, {t('liveRuns.scope')}</span>
          </span>
        </Button>
      }
    />
  );
}
