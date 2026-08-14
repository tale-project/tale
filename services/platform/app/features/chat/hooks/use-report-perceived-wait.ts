'use client';

/**
 * Persist the client's "You waited" duration once the answer first paints.
 *
 * A duration, never a pair of timestamps — the action host and the browser
 * do not share a clock. Only a row born from this client's send (the
 * `pending-assistant-*` key) reports; a reload of a turn nobody watched
 * leaves the field absent.
 */

import { useConvex } from 'convex/react';
import { useEffect, useRef } from 'react';

import { useClockOffset } from '@/app/hooks/use-clock-offset';
import { api } from '@/convex/_generated/api';

const PENDING_ASSISTANT_KEY = /^pending-assistant-(\d+)$/;
const MAX_PERCEIVED_WAIT_MS = 30 * 60 * 1000;

export function useReportPerceivedWait(
  organizationId: string | undefined,
  message: { id: string; key: string },
  painted: boolean,
): void {
  const convex = useConvex();
  const { clientEpochNow } = useClockOffset();
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current || !painted || organizationId === undefined) return;
    const match = PENDING_ASSISTANT_KEY.exec(message.key);
    if (match === null) return;
    if (message.id.startsWith('pending-')) return;
    const start = Number(match[1]);
    if (!Number.isFinite(start)) return;
    const wait = clientEpochNow() - start;
    if (!Number.isFinite(wait) || wait <= 0) return;
    sent.current = true;
    void convex
      ?.mutation(api.chat.messages.reportPerceivedWait, {
        organizationId,
        messageId: message.id,
        perceivedWaitMs: Math.min(wait, MAX_PERCEIVED_WAIT_MS),
      })
      .catch(() => undefined);
  }, [
    painted,
    message.key,
    message.id,
    organizationId,
    convex,
    clientEpochNow,
  ]);
}
