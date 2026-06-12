'use client';

import { useMemo } from 'react';

import { useSessionProgress } from '../hooks/queries';
import { buildExternalAgentParts } from '../utils/build-external-agent-parts';
import {
  buildMessageSegments,
  deriveActivity,
} from '../utils/build-message-segments';
import type { RouteReason } from '../utils/route-reason';
import {
  InlineReasoning,
  MessageThoughtHeader,
  ThinkingIndicator,
  ToolStepRow,
} from './thought-timeline';

interface ExternalAgentLiveTimelineProps {
  threadId: string | undefined;
  /** Wall-clock anchor for the "Thinking · Ns" header (shared with the bare
   *  placeholder so the timer is continuous across the handoff). */
  turnStartMs?: number;
  /** Fallback placeholder props when there's no external-agent op yet (or this
   *  is a normal chat turn) — keeps the existing routing/thinking affordance. */
  phase: 'routing' | 'thinking';
  routedAgentName?: string;
  routeReason?: RouteReason;
  /** Mid-turn steer (external-agent queue mode): the running turn's live
   *  timeline is already rendering inside the still-streaming assistant
   *  bubble ABOVE the queued user message, so rendering it here too would
   *  duplicate that turn's activity below the steer and visibly "jump"
   *  upward at the seam. When true, skip the running-timeline branch and
   *  render only the placeholder (the session-op subscription stays — its
   *  lastEventAt drives the placeholder's honest-silence label). */
  placeholderOnly?: boolean;
}

/**
 * In-flight feedback for an external-agent (Claude Code / OpenCode) turn. While
 * the thread's sandbox session op is `running`, render the live tool-use
 * timeline built from its streamed `recentEvents` — the same header strip +
 * reasoning/tool rows the assistant bubble renders, fed by synthesized parts;
 * otherwise fall back to the plain ThinkingIndicator (normal chat, or before
 * the first event lands). The final answer still arrives as the saved thread
 * message on completion.
 */
export function ExternalAgentLiveTimeline({
  threadId,
  turnStartMs,
  phase,
  routedAgentName,
  routeReason,
  placeholderOnly,
}: ExternalAgentLiveTimelineProps) {
  const progress = useSessionProgress(threadId);
  const parts = useMemo(
    () =>
      !placeholderOnly && progress?.status === 'running'
        ? buildExternalAgentParts(progress.recentEvents)
        : [],
    [placeholderOnly, progress?.status, progress?.recentEvents],
  );
  const { segments, toolCount, skillCount, hasReasoning } = useMemo(
    () => buildMessageSegments(parts),
    [parts],
  );
  // The agent's narration maps to reasoning parts and the final answer arrives
  // as the saved message, so only the thought rows render here — no text runs.
  const thoughtSegments = segments.filter((s) => s.kind !== 'text');
  // Anchor on startedAt before the first event lands — a turn that wedges at
  // CLI boot is exactly the silent-but-alive case the honest label exists for.
  const lastEventAt =
    progress?.status === 'running'
      ? (progress.lastEventAt ?? progress.startedAt)
      : undefined;

  if (
    !placeholderOnly &&
    progress?.status === 'running' &&
    thoughtSegments.length > 0
  ) {
    return (
      <div className="px-4 py-3">
        <MessageThoughtHeader
          isStreaming
          hasAnswerStarted={false}
          toolCount={toolCount}
          skillCount={skillCount}
          hasReasoning={hasReasoning}
          activity={deriveActivity(segments)}
          {...(turnStartMs !== undefined && { turnStartMs })}
          {...(lastEventAt !== undefined && { lastEventAt })}
        />
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

  return (
    <ThinkingIndicator
      className="px-4 py-3"
      phase={phase}
      {...(routedAgentName !== undefined && { routedAgentName })}
      {...(routeReason !== undefined && { routeReason })}
      {...(turnStartMs !== undefined && { turnStartMs })}
      {...(lastEventAt !== undefined && { lastEventAt })}
    />
  );
}
