'use client';

import { useMutation } from 'convex/react';

import { Switch } from '@/app/components/ui/forms/switch';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useVoiceAudioElement } from '../hooks/voice-output-context';
import { primeAudio } from '../utils/prime-audio';

interface ThreadVoiceOutputSwitchRowProps {
  threadId: string;
  enabled: boolean;
}

/**
 * Per-thread voice-output Switch rendered inside the chat-header "..."
 * dropdown. Renders only when the master pref is ON (the parent gates
 * inclusion via `userDefault`); toggling writes a thread-level override.
 *
 * The tri-state inheriting/explicit-on/explicit-off semantics of the old
 * speaker-icon toggle are intentionally collapsed to a binary switch — the
 * master-OFF gate makes "clear override" redundant in practice.
 */
export function ThreadVoiceOutputSwitchRow({
  threadId,
  enabled,
}: ThreadVoiceOutputSwitchRowProps) {
  const { t } = useT('chat');
  const setOverride = useMutation(
    api.tts.mutations.setThreadVoiceOutputOverride,
  );
  const audioElement = useVoiceAudioElement();

  return (
    <div className="px-2 py-1.5">
      <Switch
        label={t('voice.voiceOutputThreadSwitchLabel')}
        checked={enabled}
        onCheckedChange={(next) => {
          // Bank the user-gesture token synchronously when enabling, so
          // iOS Safari's autoplay gate accepts the first synthesised chunk
          // even though the mutation round-trip happens between this click
          // and playback start.
          if (next) primeAudio(audioElement);
          void setOverride({ threadId, override: next });
        }}
      />
    </div>
  );
}
