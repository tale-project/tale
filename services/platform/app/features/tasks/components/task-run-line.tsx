'use client';

/**
 * What a task's live run does, said in one short line — the card's live line
 * and the list row's chip read it from here, so the two never word the same
 * run differently. A parked agent run says why in its Run row's own words
 * (`agentRun.waiting.*`); a queued one says "Queued", like its Run row.
 */

import { cn } from '@tale/ui/cn';
import {
  Bot,
  CircleHelp,
  Clock,
  type LucideIcon,
  MessageCircleQuestion,
} from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { waitingCopyKey } from './task-agent-run-waiting';
import { runActivity, type TaskRunState } from './task-board-context';

export interface TaskLiveLine {
  icon: LucideIcon;
  text: string;
  className: string;
  /** Only work in motion pulses. */
  pulse: boolean;
}

const QUIET = 'text-muted-foreground';
// A wait that is someone's move reads like a question to them.
const SOMEONES_MOVE = 'text-amber-700 dark:text-amber-400';

/** The line for a run state, naming the working agent when it is known. */
export function useTaskRunLine(): (
  state: TaskRunState | undefined,
  agentName?: string,
) => TaskLiveLine | null {
  const { t } = useT('tasks');
  return (state, agentName) => {
    if (state === undefined) return null;
    switch (state.kind) {
      case 'asking':
        return {
          icon: MessageCircleQuestion,
          text: t('agentRuns.needsAnswer'),
          className: SOMEONES_MOVE,
          pulse: false,
        };
      case 'working':
        return {
          icon: Bot,
          text:
            agentName !== undefined
              ? t('board.agentWorking', { name: agentName })
              : t('agentRuns.working'),
          className: 'text-primary',
          pulse: true,
        };
      case 'waiting':
        return {
          icon: Clock,
          text: t(`agentRun.waiting.${waitingCopyKey(state.reason)}`),
          className: QUIET,
          pulse: false,
        };
      case 'queued':
        return {
          icon: Clock,
          text: t('agentRuns.status.queued'),
          className: QUIET,
          pulse: false,
        };
      case 'automationWaiting':
        return {
          icon: Clock,
          text: t(`board.automationWaiting.${state.waitingFor ?? 'unknown'}`),
          className:
            runActivity(state) === 'waitingForInput' ? SOMEONES_MOVE : QUIET,
          pulse: false,
        };
      case 'unknown':
        return {
          icon: CircleHelp,
          text: t('board.runUnknown'),
          className: QUIET,
          pulse: false,
        };
      default: {
        const exhaustive: never = state;
        return exhaustive;
      }
    }
  };
}

/** The line as drawn: icon and words, read through the title's description
 * rather than a second time. */
export function TaskLiveLineView({
  line,
  as: Tag = 'span',
  className,
  textClassName,
}: {
  line: TaskLiveLine;
  as?: 'p' | 'span';
  className?: string;
  textClassName?: string;
}) {
  return (
    <Tag
      aria-hidden="true"
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-xs font-medium',
        line.className,
        className,
      )}
    >
      <line.icon
        className={cn(
          'size-3.5 shrink-0',
          line.pulse && 'animate-pulse motion-reduce:animate-none',
        )}
        aria-hidden="true"
      />
      <span className={cn('min-w-0 truncate', textClassName)}>{line.text}</span>
    </Tag>
  );
}
