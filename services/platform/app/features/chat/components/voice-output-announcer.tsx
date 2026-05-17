'use client';

import { useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  type AnnouncerSnapshot,
  useVoiceAnnouncerState,
} from '../hooks/voice-output-context';
import { errorMessageForCode } from '../utils/voice-error-messages';

/**
 * Chat-level screen-reader announcer for voice-output state changes.
 *
 * Lives as a single `aria-live="polite"` region OUTSIDE the parent
 * `<ChatMessages>` `role="log"` so transitions are announced exactly
 * once. The earlier per-indicator nested aria-live (removed in
 * `3d38f711b`) made screen readers announce every state flip on every
 * mounted assistant bubble — through both the indicator's own live
 * region AND the parent log — producing audible duplicates.
 *
 * Announcements are queued and drained one-at-a-time with a 1500ms hold
 * per entry. Without the queue, a rapid `playing → blocked → error`
 * burst (e.g. chunk failure cascade) within 1.5s would clobber the
 * previous text mid-utterance because `setText(next)` replaced before
 * the previous hold finished — screen readers interrupted and re-read,
 * silently losing the intermediate state.
 *
 * Error transitions carry a specific `errorCode` so the announcer can
 * speak an actionable reason ("Voice provider not configured", "Voice
 * budget reached") instead of the generic "Voice output failed". The
 * indicator's per-code tooltip is hover-only and was unreachable on
 * touch devices.
 */
const ANNOUNCEMENT_HOLD_MS = 1500;

export function VoiceOutputAnnouncer() {
  const { t } = useT('chat');
  const snapshot = useVoiceAnnouncerState();
  const [text, setText] = useState('');
  const queueRef = useRef<string[]>([]);
  const drainingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Deduplicate against the last-enqueued snapshot so a redundant
  // useEffect re-fire (StrictMode double-mount, dep churn) doesn't
  // double-queue the same announcement.
  const lastSnapshotRef = useRef<AnnouncerSnapshot | null>(null);

  useEffect(() => {
    const last = lastSnapshotRef.current;
    if (
      last &&
      last.state === snapshot.state &&
      last.errorCode === snapshot.errorCode
    ) {
      return;
    }
    lastSnapshotRef.current = snapshot;
    const next = messageForSnapshot(snapshot, t);
    if (!next) return;
    queueRef.current.push(next);
    if (drainingRef.current) return;
    drainingRef.current = true;
    const drain = () => {
      const upcoming = queueRef.current.shift();
      if (upcoming === undefined) {
        drainingRef.current = false;
        // Clear after the last entry so a subsequent identical
        // transition is still announced. Without the clear, SRs see
        // no DOM change and skip the re-announcement.
        setText('');
        return;
      }
      setText(upcoming);
      timerRef.current = setTimeout(drain, ANNOUNCEMENT_HOLD_MS);
    };
    drain();
  }, [snapshot, t]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      queueRef.current = [];
      drainingRef.current = false;
    };
  }, []);

  return (
    <div
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {text}
    </div>
  );
}

function messageForSnapshot(
  snapshot: AnnouncerSnapshot,
  t: (key: string) => string,
): string {
  switch (snapshot.state) {
    case 'playing':
      return t('voice.voiceOutputAnnounceSpeaking');
    case 'stopped':
      return t('voice.voiceOutputAnnounceStopped');
    case 'blocked':
      return t('voice.voiceOutputAnnounceBlocked');
    case 'error':
      // SR-specific fallback key: hover/click affordances aren't reachable
      // for SR users, so the announcer copy reads differently from the
      // indicator badge.
      return errorMessageForCode(
        snapshot.errorCode,
        t,
        'voice.voiceOutputAnnounceError',
      );
    case 'idle':
    default:
      return '';
  }
}
