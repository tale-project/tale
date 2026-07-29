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
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

/** One entry of the op's `liveTimeline`, as the public query returns it. */
interface TimelinePart {
  type: string;
  text?: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

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

interface AccumulatedEntry {
  key: string;
  part: TimelinePart;
}

/** The builder tail-slices a long text block behind a leading ellipsis; strip
 * it so overlap checks compare the words, not the marker. */
function strippedText(part: TimelinePart): string {
  return (part.text ?? '').replace(/^…/, '');
}

/**
 * Fold one server flush into the transcript accumulated so far.
 *
 * The op row keeps a bounded RECENT TAIL that every drain window rebuilds
 * from scratch — entries routinely vanish from its head, and a fresh window
 * can briefly flush a much shorter list. A monitoring log must never eat what
 * the reader already saw, so the merge only ever updates or appends:
 * tool entries are identified by `toolCallId` and updated in place as they
 * move input→output; a text block has no id, so it is keyed to the tool
 * entry it follows (the builder emits at most one text block per gap). A
 * text block whose anchor tool was trimmed away re-arrives keyed to the
 * start — appending it would repeat prose the reader already has, so a
 * suffix-overlap with any kept text swallows it instead.
 *
 * Returns `acc` unchanged (same identity) when the flush brought nothing new.
 */
function mergeTimeline(
  acc: readonly AccumulatedEntry[],
  incoming: readonly TimelinePart[],
): readonly AccumulatedEntry[] {
  const indexByKey = new Map(acc.map((entry, index) => [entry.key, index]));
  let next: AccumulatedEntry[] | null = null;
  let anchor = '^';
  for (const part of incoming) {
    const isTool = part.toolCallId !== undefined && part.toolCallId !== '';
    const key = isTool ? `tool:${String(part.toolCallId)}` : `text:${anchor}`;
    if (isTool) anchor = String(part.toolCallId);
    const at = indexByKey.get(key);
    if (at !== undefined) {
      const kept = (next ?? acc)[at];
      if (kept !== undefined && !timelinePartsEqual(kept.part, part)) {
        next ??= [...acc];
        next[at] = { key, part };
      }
      continue;
    }
    if (!isTool && anchor === '^') {
      const words = strippedText(part);
      const repeated =
        words !== '' &&
        (next ?? acc).some(
          (entry) =>
            entry.part.toolCallId === undefined &&
            strippedText(entry.part).endsWith(words),
        );
      if (repeated) continue;
    }
    next ??= [...acc];
    indexByKey.set(key, next.length);
    next.push({ key, part });
  }
  return next ?? acc;
}

function timelinePartsEqual(a: TimelinePart, b: TimelinePart): boolean {
  return (
    a.text === b.text &&
    a.state === b.state &&
    a.errorText === b.errorText &&
    JSON.stringify(a.input) === JSON.stringify(b.input) &&
    JSON.stringify(a.output) === JSON.stringify(b.output)
  );
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
 * What the agent did INSIDE the sandbox, as a chronological transcript: its
 * own words as flowing prose, each tool call as one compact row that unfolds
 * into the full payload. Streamed onto the run's session op by the agent host
 * and read back here — the only window into a sandbox turn, which would
 * otherwise be an opaque "working…" spinner until it settles.
 *
 * The transcript reads DOWNWARD like the turn itself: the pane pins to its
 * bottom while the reader stays there (new entries just appear, chat-style)
 * and stops following the moment they scroll up, with a jump-back pill.
 * Entries accumulate client-side across the op's bounded flushes, so rows
 * never vanish mid-read. Renders nothing when the run never ran an agent
 * node.
 */
export function AgentExecutionLog({
  organizationId,
  runId,
  className,
}: {
  organizationId: string;
  runId: Id<'automationRuns'>;
  /** Sizes the scroll pane — the run dialog stretches it, the run page caps
   * it. The pane must have a bounded height for the pinning to mean anything. */
  className?: string;
}) {
  const { t } = useT('automations');
  const { t: tChat } = useT('chat');
  const opQuery = useConvexQuery(
    api.sandbox.session_queries_public.getAgentNodeSandboxOp,
    { organizationId, runId },
  );
  const op = opQuery.data ?? null;

  const [entries, setEntries] = useState<readonly AccumulatedEntry[]>([]);
  // A new exec is a new transcript — the accumulator resets rather than
  // splicing two turns together (a rerun reuses the same run row).
  const execIdRef = useRef<string | null>(null);
  const timeline = op?.liveTimeline;
  const execId = op?.execId;
  useEffect(() => {
    if (execId === undefined) return;
    if (execIdRef.current !== execId) {
      execIdRef.current = execId;
      setEntries(timeline !== undefined ? mergeTimeline([], timeline) : []);
      return;
    }
    if (timeline === undefined || timeline.length === 0) return;
    setEntries((previous) => mergeTimeline(previous, timeline));
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
    </Stack>
  );
}
