'use client';

import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  type VoiceAnnouncerState,
  useVoiceAnnouncerState,
} from '../hooks/voice-output-context';

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
 * Owns its own translated-text rendering so the live region text
 * changes when state changes, which is what screen readers observe and
 * read aloud. Empty string on idle so the SR doesn't get "idle"
 * verbalised every time playback finishes.
 */
export function VoiceOutputAnnouncer() {
  const { t } = useT('chat');
  const state = useVoiceAnnouncerState();
  // Buffer the text so we can clear it after the SR has had a chance
  // to announce — clearing the live region between announcements lets
  // SR re-read the same state if it happens twice in a row (e.g.
  // playing → stopped → playing same message).
  const [text, setText] = useState('');
  useEffect(() => {
    const next = messageForState(state, t);
    setText(next);
    if (!next) return undefined;
    // Clear after a beat so a subsequent identical transition is still
    // announced. 1500ms is the conventional SR debounce; shorter risks
    // SR missing the announcement entirely on slow virtual cursors.
    const handle = window.setTimeout(() => setText(''), 1500);
    return () => window.clearTimeout(handle);
  }, [state, t]);

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

function messageForState(
  state: VoiceAnnouncerState,
  t: (key: string) => string,
): string {
  switch (state) {
    case 'playing':
      return t('voice.voiceOutputAnnounceSpeaking');
    case 'stopped':
      return t('voice.voiceOutputAnnounceStopped');
    case 'blocked':
      return t('voice.voiceOutputAnnounceBlocked');
    case 'error':
      return t('voice.voiceOutputAnnounceError');
    case 'idle':
    default:
      return '';
  }
}
