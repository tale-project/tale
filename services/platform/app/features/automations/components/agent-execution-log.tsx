'use client';

import { CollapsibleDetails } from '@tale/ui/collapsible-details';
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
 * file/command the step touched without unfolding it. */
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

/** The payload as text, for the unfolded view. */
function detailText(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) ?? '';
}

/** First line, cut to a summary length — a transcript row is one line. */
function firstLine(text: string, max = 120): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length <= max ? line : `${line.slice(0, max)}…`;
}

/**
 * What the agent did INSIDE the sandbox, one row per step: its own reasoning
 * text and every tool call, each collapsed to a single line that unfolds into
 * the full payload on click. Streamed onto the run's session op by the agent
 * host and read back here — the only window into a sandbox turn, which would
 * otherwise be an opaque "working…" spinner until it settles.
 *
 * Bounded by construction (the op keeps a recent tail, each payload clamped),
 * so a long turn stays a readable list rather than a transcript dump. Renders
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
  // Newest first: this list sits at the bottom of a dialog that scrolls as one
  // column, so chronological order would keep the freshest activity below the
  // fold. Keys carry the ORIGINAL position — the tail is append-only, so a
  // row must not change identity when a newer entry lands above it.
  const rows = timeline
    .map((part, index) => ({
      part,
      key: part.toolCallId ?? `${part.type}-${String(index)}`,
    }))
    .toReversed();

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
        {rows.length > 0 && (
          <Text as="span" variant="muted" className="text-xs">
            {t('runs.agentLog.latestFirst')}
          </Text>
        )}
      </Row>
      {timeline.length === 0 ? (
        <Text as="p" variant="muted">
          {live ? t('runs.agentLog.starting') : t('runs.agentLog.empty')}
        </Text>
      ) : (
        <ol className="flex flex-col gap-1">
          {rows.map(({ part, key }) => {
            const isText = part.type === 'text';
            const failed = part.state === 'output-error';
            const done = part.state === 'output-available' || failed;
            const body = isText
              ? (part.text ?? '')
              : [
                  detailText(part.input),
                  failed ? part.errorText : detailText(part.output),
                ]
                  .filter((value) => value !== undefined && value !== '')
                  .join('\n\n');
            const label = isText
              ? firstLine(part.text ?? '')
              : toolLabel(part.type);
            const summary = isText ? '' : summarizeToolInput(part.input);
            // Only rows with more to show are foldable — a one-line reasoning
            // note or a bare tool call has no hidden detail to promise.
            const foldable = body.trim() !== '' && body.trim() !== label;
            const icon = isText ? (
              <MessageSquare
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden
              />
            ) : failed ? (
              <AlertTriangle
                className="text-destructive size-3.5 shrink-0"
                aria-hidden
              />
            ) : done ? (
              <CheckCircle2
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden
              />
            ) : (
              <Wrench
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden
              />
            );
            const head = (
              <span className="flex min-w-0 items-center gap-2 text-sm">
                {icon}
                <span
                  className={
                    isText ? 'min-w-0 truncate' : 'min-w-0 truncate font-medium'
                  }
                >
                  {label}
                </span>
                {summary !== '' && (
                  <span className="text-muted-foreground min-w-0 truncate">
                    {summary}
                  </span>
                )}
              </span>
            );
            return (
              <li
                // The transcript is an append-only tail; a tool row has its own
                // id, a text row only its original position.
                key={key}
                className="min-w-0"
              >
                {foldable ? (
                  <CollapsibleDetails variant="compact" summary={head}>
                    <pre className="text-muted-foreground bg-muted/50 mt-1 ml-6 max-h-64 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
                      {body}
                    </pre>
                  </CollapsibleDetails>
                ) : (
                  <span className="flex min-w-0 pl-5">{head}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Stack>
  );
}
