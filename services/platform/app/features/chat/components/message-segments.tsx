'use client';

import { memo, useMemo } from 'react';

import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-utils';

import { useThreadAgentJobs, useThreadMessages } from '../hooks/queries';
import {
  buildMessageSegments,
  type MessageSegment,
} from '../utils/build-message-segments';
import { injectCitationTags } from '../utils/inject-citation-tags';
import { type RouteReason } from '../utils/route-reason';
import { AssistantMessageContent } from './assistant-message-content';
import { InlineJobCard } from './job-card';
import {
  InlineReasoning,
  RoutingStepRow,
  STEP_INDENT,
  ToolStepRow,
} from './thought-timeline';

/** Read the streamed delegate's sub-thread id off a `delegate_*` tool result
 *  (legacy threads only — delegation was replaced by spawn_agent). */
function delegateSubThreadId(segment: MessageSegment): string | undefined {
  if (segment.kind !== 'tool' || !segment.toolName.startsWith('delegate_')) {
    return undefined;
  }
  if (
    isRecord(segment.output) &&
    typeof segment.output.subThreadId === 'string'
  ) {
    return segment.output.subThreadId;
  }
  return undefined;
}

/** Read the spawned job's id off a `spawn_agent` tool result — the anchor for
 *  the inline job card (name, live progress, status, transcript). */
function spawnedJobId(segment: MessageSegment): string | undefined {
  if (segment.kind !== 'tool' || segment.toolName !== 'spawn_agent') {
    return undefined;
  }
  if (isRecord(segment.output) && typeof segment.output.jobId === 'string') {
    return segment.output.jobId;
  }
  return undefined;
}

/** A `spawn_agent` row whose result hasn't landed yet (the call is still
 *  executing) — the case that needs the LIVE job-row anchor. */
function isUnresolvedSpawn(segment: MessageSegment): boolean {
  return (
    segment.kind === 'tool' &&
    segment.toolName === 'spawn_agent' &&
    spawnedJobId(segment) === undefined
  );
}

/**
 * Resolves jobIds for spawn rows whose tool result doesn't exist yet: while
 * the call executes, the job row (created up-front by `startJob`) carries the
 * SAME AI-SDK tool-call id as the streamed part, so matching `toolCallId` →
 * segment id anchors the card the moment the job starts — this is what makes
 * the card (progress, transcript) live DURING the run instead of appearing
 * only with the result. Subscribes only while an active turn actually has an
 * unresolved spawn row; settled rows read the jobId off their result.
 */
function useLiveJobIdsByToolCall(
  segments: MessageSegment[],
  active: boolean,
  threadId: string | undefined,
): ReadonlyMap<string, string> {
  const organizationId = useOrganizationId();
  const needsLiveAnchor = active && segments.some(isUnresolvedSpawn);
  const jobs = useThreadAgentJobs(
    organizationId ?? '',
    needsLiveAnchor && organizationId && threadId ? threadId : null,
  );
  return useMemo(() => {
    const byToolCall = new Map<string, string>();
    for (const job of jobs ?? []) {
      if (job.toolCallId) byToolCall.set(job.toolCallId, job._id);
    }
    return byToolCall;
  }, [jobs]);
}

/**
 * A live, nested timeline of a delegated sub-agent's reasoning + tool activity,
 * rendered under its `delegate_*` tool row. Subscribes to the sub-thread's
 * stream only while the parent turn is live (no history subscriptions); the
 * sub-agent's FINAL answer is already surfaced via the tool result, so only its
 * thought process (reasoning/tools) is shown here, not its answer text.
 */
function NestedDelegationTimeline({
  subThreadId,
  active,
}: {
  subThreadId: string;
  active: boolean;
}) {
  const messages = useThreadMessages(active ? subThreadId : null);
  const parts = useMemo(() => {
    const list = messages ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]?.role === 'assistant') return list[i].parts;
    }
    return undefined;
  }, [messages]);
  const { segments } = useMemo(() => buildMessageSegments(parts), [parts]);

  const thoughtSegments = segments.filter((s) => s.kind !== 'text');
  if (!active || thoughtSegments.length === 0) return null;

  return (
    // Fade the nested timeline in when the sub-thread's first steps land so
    // the delegation detail doesn't snap into the layout. Uses the SAME
    // STEP_INDENT as the inline reasoning body — one shared subordination level.
    <div className={cn('animate-content-in mt-1', STEP_INDENT)}>
      {thoughtSegments.map((segment) =>
        segment.kind === 'reasoning' ? (
          <InlineReasoning key={segment.id} step={segment} active />
        ) : (
          <div key={segment.id} className="my-2">
            <ToolStepRow step={segment} active />
          </div>
        ),
      )}
    </div>
  );
}

interface MessageSegmentsProps {
  /** Ordered text / reasoning / tool segments (chronological parts order). */
  segments: MessageSegment[];
  /** Whether the owning assistant message is still streaming — gates the live
   *  typewriter (trailing text), reasoning typewriter, and tool spinners. */
  active: boolean;
  /** When the thought header owns the reasoning (it renders a single expandable
   *  control for ALL reasoning blocks), skip the inline reasoning rows here so
   *  they aren't shown twice. Only the action rows (tools, routing) stay inline.
   *  False (e.g. redacted-only reasoning with no header) keeps the inline note. */
  headerOwnsReasoning?: boolean;
  /** Citation numbers present in this message, for inline `[N]` injection. */
  citationNumbers: Set<number>;
  onSendFollowUp?: (message: string) => void;
  messageId: string;
  threadId?: string;
  voiceModeEnabled: boolean;
  isFreshSinceMount: boolean;
  /** Auto-routed turn: render a "Routed to X" chip as the first inline step (it
   *  precedes any part, so it isn't a segment). */
  routedAgentName?: string;
  routeReason?: RouteReason;
  /** Fired when the trailing text run's typewriter finishes revealing — the
   *  bubble uses it to surface the post-answer toolbar only after the drain. */
  onRevealComplete?: () => void;
}

/** Normalize doubled table pipes + inject citation tags, per text segment (the
 *  transforms the single-blob path used to run once on `message.content`). */
function prepareText(text: string, citationNumbers: Set<number>): string {
  return injectCitationTags(text.replace(/\|\|+/g, '|'), citationNumbers);
}

/**
 * Renders an assistant message as the ORDERED, interleaved sequence of its
 * segments — answer text, collapsible inline reasoning, and tool/delegation
 * rows — in the chronological order the model emitted them, so thinking and
 * tool activity appear BETWEEN chunks of output rather than hoisted into one
 * block up front.
 *
 * Only the trailing text run streams (the single-active-`TypewriterText`
 * invariant); earlier text runs are `done` and render statically. A plain
 * answer (one text segment, no reasoning/tools/route) renders a bare
 * `AssistantMessageContent` — byte-identical to the pre-interleave path.
 */
function MessageSegmentsImpl({
  segments,
  active,
  headerOwnsReasoning,
  citationNumbers,
  onSendFollowUp,
  messageId,
  threadId,
  voiceModeEnabled,
  isFreshSinceMount,
  routedAgentName,
  routeReason,
  onRevealComplete,
}: MessageSegmentsProps) {
  const showRouting = !!routedAgentName && !!routeReason;
  const liveJobIdByToolCall = useLiveJobIdsByToolCall(
    segments,
    active,
    threadId,
  );

  return (
    <>
      {showRouting && (
        <div className="mb-2">
          <RoutingStepRow agentName={routedAgentName} reason={routeReason} />
        </div>
      )}
      {segments.map((segment) => {
        switch (segment.kind) {
          case 'text':
            return (
              <AssistantMessageContent
                key={segment.id}
                text={prepareText(segment.text, citationNumbers)}
                // Only the FINAL text run owns the live typewriter; earlier runs
                // are settled and render statically (keeps one active stream).
                isStreaming={
                  active && segment.isLast && segment.state === 'streaming'
                }
                onSendFollowUp={onSendFollowUp}
                messageId={messageId}
                threadId={threadId}
                voiceModeEnabled={voiceModeEnabled}
                isFreshSinceMount={isFreshSinceMount}
                onRevealComplete={segment.isLast ? onRevealComplete : undefined}
              />
            );
          case 'reasoning':
            // The thought header owns reasoning (single expandable control) —
            // skip the inline block so it isn't shown twice.
            if (headerOwnsReasoning) return null;
            return (
              <InlineReasoning
                key={segment.id}
                step={segment}
                active={active}
              />
            );
          case 'tool': {
            // A `spawn_agent` call renders its live job card right beneath
            // the row — where the spawn happened, not at the end of the turn.
            // While the call is still executing (no result yet) the id comes
            // from the live job rows, matched on the shared tool-call id.
            const jobId =
              spawnedJobId(segment) ?? liveJobIdByToolCall.get(segment.id);
            // A streamed `delegate_*` call (legacy threads) also renders a
            // live, nested timeline of the sub-agent's work beneath its row.
            const subThreadId = delegateSubThreadId(segment);
            return (
              <div key={segment.id} className="my-2">
                <ToolStepRow step={segment} active={active} />
                {jobId && (
                  // The worker row sits at the SAME level as the spawn row —
                  // two peer events in the timeline (the act, then the actor),
                  // not a nested child of the tool chip.
                  <div className="mt-2">
                    <InlineJobCard jobId={jobId} />
                  </div>
                )}
                {subThreadId && (
                  <NestedDelegationTimeline
                    subThreadId={subThreadId}
                    active={active}
                  />
                )}
              </div>
            );
          }
          default:
            // `segment.kind` is a closed union; this would become a type error
            // if a new kind were added without a matching case.
            return segment satisfies never;
        }
      })}
    </>
  );
}

export const MessageSegments = memo(MessageSegmentsImpl);
