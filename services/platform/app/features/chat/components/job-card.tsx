'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  MinusCircle,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { AgentJobCard } from '../hooks/queries';
import { useAgentJob, useThreadMessages } from '../hooks/queries';
import { buildMessageSegments } from '../utils/build-message-segments';
import { StepRow, ToolStepRow } from './thought-timeline/step-rows';

/**
 * Live status of one spawned agent-on-demand job, rendered INLINE under its
 * `spawn_agent` tool row (the row's persisted result carries the jobId).
 * Renders through the SAME `StepRow` primitive as the tool rows — leading
 * glyph (spinner while running, warning on failure, the worker icon
 * otherwise), the worker's name as the title, and the details (description,
 * live progress checklist, narrowing report, transcript) behind the row's own
 * expander — so it is visually indistinguishable from its tool siblings.
 */
export function InlineJobCard({ jobId }: { jobId: string }) {
  const organizationId = useOrganizationId();
  const { job } = useAgentJob(
    organizationId ?? '',
    organizationId ? jobId : null,
  );
  if (!job) return null;
  return <JobCard job={job} />;
}

function JobCardComponent({ job }: { job: AgentJobCard }) {
  const { t } = useT('jobCard');

  const statusKey = {
    running: 'statusRunning',
    completed: 'statusCompleted',
    failed: 'statusFailed',
    timed_out: 'statusTimedOut',
    cancelled: 'statusCancelled',
  }[job.status];
  const failed = job.status !== 'running' && job.status !== 'completed';

  // 100% the tool-row contract: state is the leading glyph alone (spinner /
  // warning / worker icon), the collapsed row carries NO extra text, and —
  // exactly like a tool's errorText — a detail line appears only on failure.
  return (
    <StepRow
      icon={Bot}
      status={job.status === 'running' ? 'active' : failed ? 'error' : 'done'}
      title={job.name}
      detail={
        failed && job.failureReason
          ? t(`failure.${job.failureReason}`)
          : undefined
      }
      expandedContent={<JobDetails job={job} statusKey={statusKey} />}
    />
  );
}

/** The row's drill-down: status, description, progress, narrowing, transcript. */
function JobDetails({
  job,
  statusKey,
}: {
  job: AgentJobCard;
  statusKey: string;
}) {
  const { t } = useT('jobCard');
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const narrowedItems = [
    ...job.narrowed.tools,
    ...job.narrowed.skills,
    ...job.narrowed.integrations,
    ...(job.narrowed.methodology ? [job.narrowed.methodology] : []),
  ];

  const statusLine = [
    t(statusKey),
    ...(job.durationMs !== undefined
      ? [t('duration', { seconds: Math.round(job.durationMs / 1000) })]
      : []),
  ].join(' · ');

  return (
    <Stack gap={2} className="mt-1.5 ml-4">
      <Text as="div" variant="muted" className="text-xs leading-snug">
        {statusLine} — {job.description}
      </Text>

      {job.progress.length > 0 && (
        <Stack as="ol" gap={2} className="m-0 list-none p-0">
          {job.progress.map((item) => (
            <JobProgressRow key={item.id} item={item} />
          ))}
        </Stack>
      )}

      {narrowedItems.length > 0 && (
        <HStack align="center" className="gap-1.5">
          <AlertTriangle className="text-warning size-3 shrink-0" />
          <Text as="div" variant="muted" className="text-xs leading-snug">
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
  );
}

/** One checklist item, in the timeline's slim-row idiom (small glyph + text). */
function JobProgressRow({ item }: { item: AgentJobCard['progress'][number] }) {
  const iconClass = 'mt-0.5 size-3.5 shrink-0';
  const icon =
    item.status === 'done' ? (
      <Check className={cn(iconClass, 'text-emerald-500')} aria-hidden />
    ) : item.status === 'in_progress' ? (
      <CircleDot className={cn(iconClass, 'text-primary')} aria-hidden />
    ) : item.status === 'failed' ? (
      <AlertTriangle
        className={cn(iconClass, 'text-destructive')}
        aria-hidden
      />
    ) : item.status === 'cancelled' ? (
      <MinusCircle
        className={cn(iconClass, 'text-muted-foreground')}
        aria-hidden
      />
    ) : (
      <Circle className={cn(iconClass, 'text-muted-foreground')} aria-hidden />
    );

  return (
    <li className="flex gap-2">
      {icon}
      <Stack className="min-w-0 flex-1 gap-0.5">
        <Text
          as="div"
          className={cn(
            'text-sm leading-snug',
            item.status === 'done' &&
              'text-muted-foreground line-through decoration-muted-foreground/60',
            item.status === 'cancelled' && 'text-muted-foreground line-through',
          )}
        >
          {item.content}
        </Text>
        {item.note && (
          <Text
            as="div"
            variant="muted"
            className={cn(
              'text-xs leading-snug',
              item.status === 'failed' && 'text-destructive/80',
            )}
          >
            {item.note}
          </Text>
        )}
      </Stack>
    </li>
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
      <Text as="div" variant="muted" className="text-xs">
        {t('transcriptEmpty')}
      </Text>
    );
  }

  return (
    <div className="border-border/60 ml-1 border-l pl-3">
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
