'use client';

import { cn } from '@tale/ui/cn';
import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  Loader2,
} from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { useChatQuery } from '../data/chat-backend';

/** Rows the tray shows; a chat hands over a handful, the board has the rest. */
const TRAY_ROWS = 3;

type TrayTask = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: string;
  assigneeType: string | null;
  outputCount: number;
  run?: {
    status: string;
    retryPending?: boolean;
    waitingForCapacity?: boolean;
  };
};

type TrayTone = 'working' | 'attention' | 'done' | 'idle';

/** What a task made from this chat is doing now, in one short line. */
function trayState(
  task: TrayTask,
  t: (key: string, values?: Record<string, unknown>) => string,
  tTasks: (key: string) => string,
): { text: string; tone: TrayTone } {
  const run = task.run;
  const agentTask = task.assigneeType === 'agent';
  if (task.status === 'done' || task.status === 'cancelled') {
    return { text: tTasks(`status.${task.status}`), tone: 'done' };
  }
  if (task.status === 'in_review') {
    return {
      text:
        task.outputCount > 0
          ? t('taskTray.readyWithFiles', { count: task.outputCount })
          : t('taskTray.ready'),
      tone: 'done',
    };
  }
  if (agentTask && run !== undefined) {
    if (run.status === 'queued' || run.status === 'running') {
      return {
        text:
          run.status === 'queued' && run.waitingForCapacity === true
            ? t('taskTray.waitingForSlot')
            : t('taskTray.working'),
        tone: 'working',
      };
    }
    if (run.status === 'failed') {
      return run.retryPending === true
        ? { text: t('taskTray.retrying'), tone: 'working' }
        : { text: t('taskTray.failed'), tone: 'attention' };
    }
  }
  if (agentTask && run === undefined) {
    return { text: t('taskTray.notStarted'), tone: 'idle' };
  }
  return { text: tTasks(`status.${task.status}`), tone: 'idle' };
}

function TrayIcon({ tone }: { tone: TrayTone }) {
  if (tone === 'working') {
    return (
      <Loader2
        aria-hidden
        className="text-muted-foreground size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
      />
    );
  }
  if (tone === 'attention') {
    return (
      <AlertTriangle aria-hidden className="text-warning size-3.5 shrink-0" />
    );
  }
  if (tone === 'done') {
    return (
      <CheckCircle2 aria-hidden className="text-success size-3.5 shrink-0" />
    );
  }
  return (
    <Circle aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
  );
}

/**
 * The tasks this conversation handed over, above its composer: each with
 * what it is doing now — the agent working, waiting for a sandbox slot,
 * retrying, stuck on a failure, ready for review with its files — and a way
 * into it. Hand-over used to end at a toast that was gone in ten seconds;
 * the person who asked for the work now watches it where they asked.
 *
 * Only tasks the reader can open, newest first (`listTasksFromThread`).
 * Renders nothing while there are none, and nothing when the read fails: the
 * board still holds the tasks.
 */
export function ChatTaskTray({
  organizationId,
  threadId,
}: {
  organizationId: string;
  /** The conversation's root — the thread tasks name as their source. */
  threadId: string;
}) {
  const { t } = useT('chat');
  const { t: tTasks } = useT('tasks');
  const tasks = useChatQuery('tasks/queries:listTasksFromThread', {
    organizationId,
    threadId,
  });
  if (tasks.status !== 'ready' || tasks.data.length === 0) return null;
  const shown = tasks.data.slice(0, TRAY_ROWS);
  const more = tasks.data.length - shown.length;

  return (
    <section
      aria-label={t('taskTray.label')}
      className="mx-auto w-full max-w-3xl pb-2"
    >
      {/* Polite: a run that finishes or fails while the person keeps
          chatting is announced once, without taking their focus. */}
      <ul aria-live="polite" className="flex flex-col gap-1">
        {shown.map((task) => {
          const state = trayState(task, t, tTasks);
          return (
            <li
              key={task.id}
              className={cn(
                'border-border bg-muted/40 rounded-lg border px-3 py-1.5',
                // The warning alert's own edge: this row asks for the
                // person, the others only report.
                state.tone === 'attention' && 'border-amber-500/30',
              )}
            >
              <Row gap={2} align="center">
                <TrayIcon tone={state.tone} />
                <div className="min-w-0 flex-1">
                  <Text
                    as="span"
                    className="text-foreground block truncate text-xs font-medium"
                    title={task.title}
                  >
                    {task.title}
                  </Text>
                  <Text
                    as="span"
                    variant="muted"
                    className="block truncate text-xs"
                  >
                    {state.text} · {task.projectName}
                  </Text>
                </div>
                <Link
                  to="/dashboard/$id/projects/$projectId/tasks/board"
                  params={{ id: organizationId, projectId: task.projectId }}
                  search={{ task: task.id }}
                  aria-label={t('taskTray.openAria', { title: task.title })}
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium focus-visible:ring-1 focus-visible:outline-none"
                >
                  {t('taskTray.open')}
                  <ArrowUpRight aria-hidden className="size-3" />
                </Link>
              </Row>
            </li>
          );
        })}
      </ul>
      {more > 0 && (
        <Text variant="muted" className="mt-1 block px-1 text-xs">
          {t('taskTray.more', { count: more })}
        </Text>
      )}
    </section>
  );
}
