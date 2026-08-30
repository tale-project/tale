'use client';

import { Button } from '@tale/ui/button';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import {
  AlertTriangle,
  ArrowDown,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Wrench,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useAutoScroll } from '@/app/hooks/use-auto-scroll';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import {
  mergeTimelineEntries,
  strippedText,
  type TimelineEntry,
  type TimelinePart,
} from '@/lib/harnesses/timeline';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

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

/** Decorative typing indicator at the transcript's end while the turn runs —
 * the header spinner carries the accessible "working" state. */
function TypingDots() {
  return (
    <span aria-hidden className="flex h-5 items-center gap-1">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="bg-muted-foreground/60 size-1.5 animate-pulse rounded-full motion-reduce:animate-none"
          style={{ animationDelay: `${index * 150}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * The agent's latest move, as one truncated line — what the step timeline
 * shows on the RUNNING agent row while it is collapsed, so "is it moving?"
 * has an answer without unfolding the whole transcript. Renders nothing
 * unless the run's agent turn is live right now.
 */
export function AgentActivityLine({
  organizationId,
  runId,
  className,
}: {
  organizationId: string;
  runId: string;
  className?: string;
}) {
  const { t } = useT('automations');
  const opQuery = useBackendQuery(
    'sandbox/session_queries_public:getAgentNodeSandboxOp',
    { organizationId, runId },
  );
  const op = opQuery.data ?? null;
  if (op === null || op.status !== 'running') return null;
  const latest = op.liveTimeline?.at(-1);
  const line =
    latest === undefined
      ? t('runs.agentLog.starting')
      : latest.toolCallId !== undefined && latest.toolCallId !== ''
        ? [toolLabel(latest.type), summarizeToolInput(latest.input)]
            .filter((part) => part !== '')
            .join(' · ')
        : // Prose streams in as one growing block — its last line is the
          // freshest thing the agent said.
          (strippedText(latest).trimEnd().split('\n').at(-1) ??
          t('runs.agentLog.starting'));
  return (
    <span
      className={cn(
        'text-muted-foreground flex min-w-0 items-center gap-2 text-xs',
        className,
      )}
    >
      <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
      <span className="min-w-0 truncate">{line}</span>
    </span>
  );
}

/** The op fields the transcript view reads — the common projection of the
 * automation (`getAgentNodeSandboxOp`) and task (`getTaskAgentRunSandboxOp`)
 * queries, so both lanes render through ONE view. */
export interface AgentSandboxOpView {
  execId: string;
  status: string;
  progressText?: string;
  liveTimeline?: TimelinePart[];
  /** The provider-qualified model this turn ran on (`provider/model`),
   * stamped by the kick that resolved the serving — the answer to "which
   * provider actually served (and billed) this turn". */
  modelRef?: string;
  /** The model that read images for this turn — absent when the serving model
   * reads them itself. Recorded per turn, so this is the model that actually
   * ran, not whatever the org would resolve to today. */
  visionModelRef?: string;
}

/** A stamped ref is `provider/model`, and on the gateway lane the model half
 * is itself a gateway ref that starts with the same provider slug — collapse
 * the doubled segment so `openrouter/openrouter/anthropic/x` reads as the
 * one provider it names. */
function displayModelRef(ref: string): string {
  const [first, second, ...rest] = ref.split('/');
  return first !== undefined && first === second
    ? [first, ...rest].join('/')
    : ref;
}

/**
 * What the agent did INSIDE the sandbox, as a chronological transcript: its
 * own words as flowing prose, each tool call as one compact row that unfolds
 * into the full payload. Streamed onto the run's session op by the agent host
 * and read back by the caller's op query — the only window into a sandbox
 * turn, which would otherwise be an opaque "working…" spinner until it
 * settles.
 *
 * The transcript reads DOWNWARD like the turn itself: the pane pins to its
 * bottom while the reader stays there (new entries just appear, chat-style)
 * and stops following the moment they scroll up, with a jump-back pill.
 * Entries accumulate client-side across the op's bounded flushes, so rows
 * never vanish mid-read. Renders nothing while `op` is null.
 */
export function ExecutionLogView({
  op,
  hideHeader = false,
  className,
}: {
  op: AgentSandboxOpView | null;
  /** Drops the "Agent log" heading and its live spinner — for hosts whose own
   * title already names the transcript; the host then owns the liveness cue. */
  hideHeader?: boolean;
  /** Sizes the scroll pane — the run dialog stretches it, the run page caps
   * it. The pane must have a bounded height for the pinning to mean anything. */
  className?: string;
}) {
  const { t } = useT('automations');
  const { t: tChat } = useT('chat');

  const [entries, setEntries] = useState<readonly TimelineEntry[]>([]);
  // A new exec is a new transcript — the accumulator resets rather than
  // splicing two turns together (a rerun reuses the same run row).
  const execIdRef = useRef<string | null>(null);
  const timeline = op?.liveTimeline;
  const execId = op?.execId;
  useEffect(() => {
    if (execId === undefined) return;
    if (execIdRef.current !== execId) {
      execIdRef.current = execId;
      setEntries(
        timeline !== undefined ? mergeTimelineEntries([], timeline) : [],
      );
      return;
    }
    if (timeline === undefined || timeline.length === 0) return;
    setEntries((previous) => mergeTimelineEntries(previous, timeline));
  }, [execId, timeline]);

  const { containerRef, scrollToBottom, isAtBottom } = useAutoScroll();
  // Pinned = the reader sits at (or near) the bottom, so growth may follow.
  // Their own scrolling is the only thing that unpins or re-pins.
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const live = op !== null && op.status === 'running';
  useEffect(() => {
    // Every transcript change re-pins while the reader is at the bottom —
    // `entries` identity only moves on real content, so this never fights a
    // reader who scrolled up to study an earlier row.
    if (pinnedRef.current) scrollToBottom();
  }, [entries, live, scrollToBottom]);

  if (op === null) return null;

  const rows =
    entries.length > 0
      ? entries
      : op.progressText !== undefined && op.progressText !== ''
        ? // Older op rows predate the timeline entirely; their text is still
          // a transcript of one entry.
          [{ key: 'text:^', part: { type: 'text', text: op.progressText } }]
        : [];

  return (
    <Stack as="section" gap={2} className="min-h-0 flex-1">
      {!hideHeader && (
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
      )}
      {rows.length === 0 && !live ? (
        <Text as="p" variant="muted">
          {t('runs.agentLog.empty')}
        </Text>
      ) : (
        <div className="relative min-h-0 flex-1">
          <div
            ref={containerRef}
            onScroll={() => {
              pinnedRef.current = isAtBottom();
              setShowJump(!pinnedRef.current);
            }}
            className={cn('overflow-y-auto pr-1', className ?? 'max-h-96')}
          >
            <ol className="flex flex-col gap-2">
              {rows.map(({ key, part }) => {
                const isText = part.toolCallId === undefined;
                if (isText) {
                  return (
                    <li key={key} className="min-w-0">
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {part.text ?? ''}
                      </p>
                    </li>
                  );
                }
                const failed = part.state === 'output-error';
                const done = part.state === 'output-available' || failed;
                const body = [
                  detailText(part.input),
                  failed ? part.errorText : detailText(part.output),
                ]
                  .filter((value) => value !== undefined && value !== '')
                  .join('\n\n');
                const label = toolLabel(part.type);
                const summary = summarizeToolInput(part.input);
                const icon = failed ? (
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
                    <span className="min-w-0 truncate font-medium">
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
                  <li key={key} className="min-w-0">
                    {body.trim() !== '' ? (
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
              {live && (
                <li key="typing" className="min-w-0" aria-hidden>
                  {rows.length === 0 ? (
                    <Row gap={2} align="center">
                      <MessageSquare
                        className="text-muted-foreground size-3.5 shrink-0"
                        aria-hidden
                      />
                      <Text as="span" variant="muted" className="text-sm">
                        {t('runs.agentLog.starting')}
                      </Text>
                    </Row>
                  ) : (
                    <TypingDots />
                  )}
                </li>
              )}
            </ol>
          </div>
          {showJump && (
            <div className="absolute inset-x-0 bottom-2 flex justify-center">
              <Button
                size="sm"
                variant="secondary"
                icon={ArrowDown}
                className="shadow-md"
                onClick={() => {
                  pinnedRef.current = true;
                  setShowJump(false);
                  scrollToBottom();
                }}
              >
                {tChat('scrollToBottom')}
              </Button>
            </div>
          )}
        </div>
      )}
      {/* Which serving the turn ACTUALLY ran on. A footnote like the vision
          line: the question ("whose key billed this?") is only asked after
          the fact, and the ref names the provider a pinless node's walk
          landed on — which the editor cannot promise in advance. */}
      {op.modelRef !== undefined && (
        <Text as="p" variant="muted" className="text-xs">
          {t('runs.agentLog.servedBy', {
            model: displayModelRef(op.modelRef),
          })}
        </Text>
      )}
      {/* Which model read this turn's images. A footnote, not a header row:
          it answers a question the reader only asks when an image read went
          wrong — and the task dialog hides the header entirely, which is
          exactly where that question gets asked. */}
      {op.visionModelRef !== undefined && (
        <Text as="p" variant="muted" className="text-xs">
          {t('runs.agentLog.visionModel', {
            model: displayModelRef(op.visionModelRef),
          })}
        </Text>
      )}
    </Stack>
  );
}

/**
 * An automation run's agent transcript — {@link ExecutionLogView} bound to
 * the run's `workflow-agent` session op. Renders nothing when the run never
 * ran an agent node.
 */
export function AgentExecutionLog({
  organizationId,
  runId,
  className,
}: {
  organizationId: string;
  runId: string;
  className?: string;
}) {
  const opQuery = useBackendQuery(
    'sandbox/session_queries_public:getAgentNodeSandboxOp',
    { organizationId, runId },
  );
  return <ExecutionLogView op={opQuery.data ?? null} className={className} />;
}
