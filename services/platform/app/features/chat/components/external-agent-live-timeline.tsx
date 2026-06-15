'use client';

import { useMemo } from 'react';

import { useSessionProgress } from '../hooks/queries';
import { buildExternalAgentParts } from '../utils/build-external-agent-parts';
import {
  buildMessageSegments,
  type MessageSegment,
} from '../utils/build-message-segments';
import type { RouteReason } from '../utils/route-reason';
import {
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
}: ExternalAgentLiveTimelineProps) {
  const progress = useSessionProgress(threadId);
  const parts = useMemo(
    () =>
      progress?.status === 'running'
        ? buildExternalAgentParts(progress.recentEvents)
        : [],
    [progress?.status, progress?.recentEvents],
  );
  const { segments, toolCount, skillCount, hasReasoning } = useMemo(
    () => buildMessageSegments(parts),
    [parts],
  );
  // The agent's narration maps to reasoning parts and the final answer arrives
  // as the saved message, so only the thought rows render here — no text runs.
  const thoughtSegments = segments.filter((s) => s.kind !== 'text');
  // The header is the single thinking control — it owns reasoning (expandable),
  // so only the action (tool) rows render inline. Mirrors the saved bubble.
  const reasoningSteps = segments.filter(
    (s): s is Extract<MessageSegment, { kind: 'reasoning' }> =>
      s.kind === 'reasoning',
  );

  if (progress?.status === 'running' && thoughtSegments.length > 0) {
    return (
      <div className="px-4 py-3">
        <MessageThoughtHeader
          isStreaming
          hasAnswerStarted={false}
          toolCount={toolCount}
          skillCount={skillCount}
          hasReasoning={hasReasoning}
          reasoningSteps={reasoningSteps}
          {...(turnStartMs !== undefined && { turnStartMs })}
        />
        {thoughtSegments.map((segment) =>
          // Reasoning is owned by the header above; render only action rows.
          segment.kind === 'reasoning' ? null : (
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
    />
  );
}
