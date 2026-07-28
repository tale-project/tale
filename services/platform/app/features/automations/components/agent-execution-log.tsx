'use client';

import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Wrench,
} from 'lucide-react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

/** Compact one-line rendering of a tool call's input — enough to tell WHICH
 * file/command the step touched without dumping the payload. */
function summarizeToolInput(input: unknown): string {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return input;
  if (typeof input === 'number' || typeof input === 'boolean') {
    return String(input);
  }
  if (typeof input !== 'object') return '';
  const record: Record<string, unknown> = { ...input };
  for (const key of [
    'command',
    'file_path',
    'path',
    'pattern',
    'query',
    'url',
    'prompt',
    'description',
  ]) {
    const value = record[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return JSON.stringify(input) ?? '';
}

/** `tool-Read` → `Read`; anything else renders as-is. */
function toolLabel(type: string): string {
  return type.startsWith('tool-') ? type.slice('tool-'.length) : type;
}

/**
 * What the agent is doing INSIDE the sandbox, for the run's viewers: the
 * harness's own text plus each tool call it made, streamed live onto the
 * run's session op by the agent host and read back here. This is the user's
 * window into a sandbox turn — without it an `agent` node is an opaque
 * "working…" spinner until it settles.
 *
 * Bounded by construction (the op keeps a recent tail, each payload clamped),
 * so a long turn stays a readable log rather than a transcript dump. Renders
 * nothing when the run never ran an agent node.
 */
export function AgentExecutionLog({
  organizationId,
  runId,
}: {
  organizationId: string;
  runId: Id<'automationRuns'>;
}) {
  const { t } = useT('automations');
  const opQuery = useConvexQuery(
    api.sandbox.session_queries_public.getAgentNodeSandboxOp,
    { organizationId, runId },
  );
  const op = opQuery.data ?? null;
  if (op === null) return null;

  const live = op.status === 'running';
  // The text and timeline writes are separate throttled flushes, and older op
  // rows predate the timeline entirely — so a turn with text but no timeline
  // yet still has something to show: its text, as one entry.
  const timeline =
    op.liveTimeline !== undefined && op.liveTimeline.length > 0
      ? op.liveTimeline
      : op.progressText !== undefined && op.progressText !== ''
        ? [{ type: 'text', text: op.progressText }]
        : [];

  return (
    <Stack as="section" gap={2}>
      <Row gap={2} align="center">
        <Text as="h3" variant="label">
          {t('runs.agentLog.title')}
        </Text>
        {live && (
          <Loader2
            className="text-muted-foreground size-3.5 animate-spin"
            aria-hidden
          />
        )}
      </Row>
      {timeline.length === 0 ? (
        <Text as="p" variant="muted">
          {live ? t('runs.agentLog.starting') : t('runs.agentLog.empty')}
        </Text>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {timeline.map((part, index) => {
            if (part.type === 'text') {
              return (
                <li
                  // The transcript is an append-only tail; index is its only
                  // stable identity for text parts (tool parts carry an id).
                  key={`text-${String(index)}`}
                  className="flex min-w-0 items-start gap-2 text-sm"
                >
                  <MessageSquare
                    className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
                    aria-hidden
                  />
                  <span className="min-w-0 whitespace-pre-wrap">
                    {part.text}
                  </span>
                </li>
              );
            }
            const failed = part.state === 'output-error';
            const done = part.state === 'output-available' || failed;
            const summary = summarizeToolInput(part.input);
            return (
              <li
                key={part.toolCallId ?? `tool-${String(index)}`}
                className="flex min-w-0 items-start gap-2 text-sm"
              >
                {failed ? (
                  <AlertTriangle
                    className="text-destructive mt-0.5 size-3.5 shrink-0"
                    aria-hidden
                  />
                ) : done ? (
                  <CheckCircle2
                    className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
                    aria-hidden
                  />
                ) : (
                  <Wrench
                    className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{toolLabel(part.type)}</span>
                  {summary !== '' && (
                    <span className="text-muted-foreground ml-2 break-all">
                      {summary}
                    </span>
                  )}
                  {failed && part.errorText !== undefined && (
                    <span className="text-destructive block break-all">
                      {part.errorText}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Stack>
  );
}
