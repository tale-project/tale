'use client';

import { useQuery } from 'convex/react';
import { useEffect, useRef, useState } from 'react';

import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import {
  extractContentDelta,
  initContentExtractState,
} from '../utils/extract-content-stream';

interface SyncStreamsDeltasResult {
  kind: 'deltas';
  deltas: {
    streamId: string;
    start: number;
    end: number;
    parts: { type: string; toolCallId?: string; inputTextDelta?: string }[];
  }[];
}

/**
 * Subscribe to the live `tool-input-delta` stream for the artifact's
 * create / edit invocation and decode the JSON `content` field as it
 * arrives. Mirrors the agent SDK's `useDeltaStreams` two-phase cursor
 * pattern so each Convex push only carries new bytes.
 *
 * Returns `{ content, hasDeltas }`. `hasDeltas` flips true on the first
 * decoded character — used by the canvas pane as the gate for switching
 * away from the legacy `streamingContent` fallback.
 */
export function useStreamedArtifactContent(
  artifactId: Id<'artifacts'> | undefined,
  toolCallId: string | undefined,
  enabled: boolean,
): { content: string; hasDeltas: boolean } {
  const [content, setContent] = useState('');
  const [cursors, setCursors] = useState<Record<string, number>>({});
  const extractStateRef = useRef(initContentExtractState());
  const lastResetKeyRef = useRef<string | null>(null);

  // Reset all state when the artifact (or its tool call) changes, or when
  // the hook is disabled. We compare via a "reset key" string so the reset
  // is idempotent across renders that share the same identity.
  const resetKey = `${artifactId ?? ''}|${toolCallId ?? ''}|${enabled ? 1 : 0}`;
  if (lastResetKeyRef.current !== resetKey) {
    lastResetKeyRef.current = resetKey;
    extractStateRef.current = initContentExtractState();
    // setState during render is allowed when guarded — React discards
    // the in-progress render and starts fresh, which is what we want.
    if (content !== '') setContent('');
    if (Object.keys(cursors).length > 0) setCursors({});
  }

  // Phase 1: list active streams for the thread the artifact lives in.
  // Each "stream" corresponds to one assistant-message generation; our
  // tool's deltas live inside the stream of the message that called us.
  const listResult = useQuery(
    api.artifacts.queries.syncArtifactStream,
    enabled && artifactId
      ? {
          artifactId,
          streamArgs: { kind: 'list' as const, startOrder: 0 },
        }
      : 'skip',
  );
  // The agent SDK returns a discriminated union; narrow via `kind`.
  const streamMessages =
    listResult && listResult.kind === 'list'
      ? (listResult.messages as {
          streamId: string;
          status: string;
          order: number;
        }[])
      : undefined;

  // Phase 2: subscribe to deltas after our per-stream cursors. Convex
  // re-fetches when `cursors` advances, so each push contains only the
  // bytes since the last accumulator update.
  const cursorList = streamMessages?.map((m) => ({
    streamId: m.streamId,
    cursor: cursors[m.streamId] ?? 0,
  }));

  const deltasResult = useQuery(
    api.artifacts.queries.syncArtifactStream,
    enabled && artifactId && cursorList && cursorList.length > 0
      ? {
          artifactId,
          streamArgs: { kind: 'deltas' as const, cursors: cursorList },
        }
      : 'skip',
  );
  const newDeltas =
    deltasResult && deltasResult.kind === 'deltas'
      ? (deltasResult.deltas as SyncStreamsDeltasResult['deltas'])
      : undefined;

  useEffect(() => {
    if (!newDeltas || newDeltas.length === 0 || !toolCallId) return;

    // Concatenate every tool-input-delta whose toolCallId matches ours,
    // in stream order. The agent SDK's listDeltas query already returns
    // rows ordered by `start` per stream (filter to gte cursor), and we
    // care only about the ones for our tool — which all live in a single
    // stream — so naive concatenation yields the right byte order.
    let chunk = '';
    const advance: Record<string, number> = {};
    for (const d of newDeltas) {
      advance[d.streamId] = Math.max(advance[d.streamId] ?? 0, d.end);
      for (const part of d.parts) {
        if (
          part.type === 'tool-input-delta' &&
          part.toolCallId === toolCallId &&
          typeof part.inputTextDelta === 'string'
        ) {
          chunk += part.inputTextDelta;
        }
      }
    }

    if (chunk) {
      const out = extractContentDelta(extractStateRef.current, chunk);
      if (out.delta) setContent((prev) => prev + out.delta);
    }

    if (Object.keys(advance).length > 0) {
      setCursors((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const [streamId, end] of Object.entries(advance)) {
          if ((next[streamId] ?? 0) < end) {
            next[streamId] = end;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [newDeltas, toolCallId]);

  return { content, hasDeltas: content.length > 0 };
}
