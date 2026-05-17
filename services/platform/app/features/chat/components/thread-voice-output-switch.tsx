'use client';

import { useMutation } from 'convex/react';
import { ConvexError } from 'convex/values';
import { useCallback } from 'react';

import type { DropdownMenuCheckboxItem } from '@/app/components/ui/overlays/dropdown-menu';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-guards';

import { useVoiceAudioElement } from '../hooks/voice-output-context';
import { primeAudio } from '../utils/prime-audio';

/**
 * Builds the per-thread voice-output toggle as a `DropdownMenuCheckboxItem`
 * descriptor, ready to be pushed into a `DropdownMenu` group.
 *
 * Caller gates inclusion — currently the chat header hides this only when
 * the org-level governance policy disables voice output for the tenant
 * (`voiceMode.source === 'org_policy'`). The toggle is shown regardless
 * of the user's master switch; toggling writes a thread-level override
 * that wins over the master switch in either direction.
 *
 * Using `type: 'checkbox'` rather than `type: 'custom' + <Switch>`:
 *  - Radix `CheckboxItem` joins the menu's roving tabindex, so the toggle
 *    is reachable via ArrowDown from neighbouring menu items.
 *  - SRs announce `role="menuitemcheckbox"` + `aria-checked`.
 *  - `min-h-11` (44px) on the row meets WCAG 2.2 AA target-size.
 *  - `onSelect` is suppressed by the renderer so toggling keeps the menu
 *    open. Round-1 / round-2 HIGH #13.
 */
export function useThreadVoiceOutputCheckboxItem(
  threadId: string | undefined,
  enabled: boolean,
): DropdownMenuCheckboxItem | null {
  const { t } = useT('chat');
  const { toast } = useToast();
  const setOverride = useMutation(
    api.tts.mutations.setThreadVoiceOutputOverride,
  );
  const audioElement = useVoiceAudioElement();
  const onCheckedChange = useCallback(
    async (next: boolean) => {
      if (!threadId) return;
      // Bank the user-gesture token synchronously when enabling, so
      // iOS Safari's autoplay gate accepts the first synthesised chunk
      // even though the mutation round-trip happens between this click
      // and playback start.
      if (next) primeAudio(audioElement);
      // Await + catch: a forbidden / network / auth-expired rejection
      // would otherwise become an unhandled promise rejection and the
      // user would only see the Convex subscription bounce the toggle
      // back to its previous state with no explanation. Project
      // CLAUDE.md forbids silent error swallowing; mirror the master
      // toggle's pattern from `personalization-settings.tsx:397-431`.
      try {
        await setOverride({ threadId, override: next });
      } catch (err) {
        console.error('[voice] thread override failed', err);
        const fallback = t('voice.voiceOutputThreadSaveFailed');
        const serverMessage =
          err instanceof ConvexError && isRecord(err.data)
            ? err.data.message
            : undefined;
        const title =
          typeof serverMessage === 'string' ? serverMessage : fallback;
        toast({ title, variant: 'destructive' });
      }
    },
    [audioElement, setOverride, threadId, t, toast],
  );
  if (!threadId) return null;
  return {
    type: 'checkbox',
    label: t('voice.voiceOutputThreadSwitchLabel'),
    checked: enabled,
    onCheckedChange,
  };
}
