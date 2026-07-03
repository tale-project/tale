'use client';

import { Badge } from '@tale/ui/badge';
import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { AgentJobCard } from '../hooks/queries';
import { useThreadMessages } from '../hooks/queries';
import { buildMessageSegments } from '../utils/build-message-segments';
import { ApprovalCard } from './approval-card';
import { ToolStepRow } from './thought-timeline/step-rows';
import { TodoRow } from './todo-list-card';

/**
 * Live status card for one spawned agent-on-demand job: worker name +
 * status, the job's own progress checklist (update_progress), the
 * capability-narrowing report, and an expandable post-hoc transcript read
 * from the job's transcript thread.
 */
function JobCardComponent({ job }: { job: AgentJobCard }) {
  const { t } = useT('jobCard');
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const narrowedItems = [
    ...job.narrowed.tools,
    ...job.narrowed.skills,
    ...job.narrowed.integrations,
    ...(job.narrowed.methodology ? [job.narrowed.methodology] : []),
  ];

  const statusKey = {
    running: 'statusRunning',
    completed: 'statusCompleted',
    failed: 'statusFailed',
    timed_out: 'statusTimedOut',
    cancelled: 'statusCancelled',
  }[job.status];

  return (
    <ApprovalCard maxWidth="md" className="my-2">
      <Stack gap={3}>
        <HStack align="center" justify="between" className="gap-2">
          <HStack align="center" className="min-w-0 gap-2">
            {job.status === 'running' ? (
              <Loader2 className="text-primary size-4 shrink-0 animate-spin motion-reduce:animate-none" />
            ) : (
              <Bot className="text-muted-foreground size-4 shrink-0" />
            )}
            <Text as="div" className="truncate font-medium">
              {job.name}
            </Text>
            <Badge
              variant={
                job.status === 'completed'
                  ? 'green'
                  : job.status === 'running'
                    ? 'blue'
                    : 'destructive'
              }
              className="shrink-0"
            >
              {t(statusKey)}
            </Badge>
          </HStack>
          {job.durationMs !== undefined && (
            <Text as="span" variant="muted" className="shrink-0 text-xs">
              {t('duration', { seconds: Math.round(job.durationMs / 1000) })}
            </Text>
          )}
        </HStack>

        <Text as="div" variant="muted" className="text-sm leading-snug">
          {job.description}
        </Text>

        {job.progress.length > 0 && (
          <Stack
            as="ol"
            gap={0}
            className="m-0 list-none rounded-lg border p-0"
          >
            {job.progress.map((item) => (
              <TodoRow
                key={item.id}
                todo={{
                  id: item.id,
                  content: item.content,
                  status: item.status,
                  findingsSummary:
                    item.status === 'done' ? item.note : undefined,
                  failureReason:
                    item.status === 'failed' ? item.note : undefined,
                }}
              />
            ))}
          </Stack>
        )}

        {job.status !== 'running' && job.failureReason && (
          <HStack align="center" className="gap-1.5">
            <AlertTriangle className="text-destructive size-3.5 shrink-0" />
            <Text as="div" className="text-destructive text-sm leading-snug">
              {t(`failure.${job.failureReason}`)}
            </Text>
          </HStack>
        )}

        {narrowedItems.length > 0 && (
          <HStack align="center" className="gap-1.5">
            <AlertTriangle className="text-warning size-3.5 shrink-0" />
            <Text as="div" variant="muted" className="text-sm leading-snug">
              {t('narrowedNotice', { items: narrowedItems.join(', ') })}
            </Text>
          </HStack>
        )}

        <button
          type="button"
          onClick={() => setTranscriptOpen((v) => !v)}
          aria-expanded={transcriptOpen}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 self-start text-xs transition-colors"
        >
          {transcriptOpen ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          {transcriptOpen ? t('hideTranscript') : t('showTranscript')}
        </button>
        {transcriptOpen && <JobTranscript jobThreadId={job.jobThreadId} />}
      </Stack>
    </ApprovalCard>
  );
}

/**
 * Post-hoc transcript of the worker's run, read from the job's own thread
 * (authorized through its `parentThreadId` summary). Subscribes only while
 * expanded. Text answers render as prose; tool activity through the shared
 * `ToolStepRow`; reasoning as muted prose.
 */
function JobTranscript({ jobThreadId }: { jobThreadId: string }) {
  const { t } = useT('jobCard');
  const messages = useThreadMessages(jobThreadId);

  const segments = useMemo(() => {
    const all = [];
    for (const message of messages ?? []) {
      if (message.role !== 'assistant') continue;
      const { segments: messageSegments } = buildMessageSegments(message.parts);
      all.push(...messageSegments);
    }
    return all;
  }, [messages]);

  if (segments.length === 0) {
    return (
      <Text as="div" variant="muted" className="text-sm">
        {t('transcriptEmpty')}
      </Text>
    );
  }

  return (
    <div className="border-border/60 ml-2 border-l pl-3">
      {segments.map((segment) =>
        segment.kind === 'tool' ? (
          <div key={segment.id} className="my-2">
            <ToolStepRow step={segment} active={false} />
          </div>
        ) : (
          <Text
            as="div"
            key={segment.id}
            variant="muted"
            className={cn(
              'my-2 text-sm whitespace-pre-wrap',
              segment.kind === 'reasoning' && 'italic',
            )}
          >
            {segment.text}
          </Text>
        ),
      )}
    </div>
  );
}

export const JobCard = memo(JobCardComponent);
