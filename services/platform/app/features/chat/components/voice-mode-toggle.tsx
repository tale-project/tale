'use client';

import { Button } from '@tale/ui/button';
import { Volume2, VolumeOff } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

/**
 * Composer voice-mode toggle — reads replies aloud for the current thread.
 * Sits next to the dictation button so the speak/listen controls live
 * together, and shows the current state at a glance (the `+`-menu checkbox
 * hid it behind a click).
 *
 * Prop-driven: the surface resolves the cascade (org veto → thread override
 * → user default) and owns the write; a veto hides the control entirely
 * rather than disabling it.
 */
export function VoiceModeToggle({
  enabled,
  onChange,
  available,
  disabled,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
  /** A text-to-speech model is configured; without one the toggle stays
   * hoverable-but-inert so the tooltip can explain itself. */
  available: boolean;
  disabled?: boolean;
}) {
  const { t } = useT('chat');

  return (
    <Tooltip
      content={
        !available
          ? t('voice.voiceOutputErrorConfig')
          : enabled
            ? t('voice.voiceModeDisable')
            : t('voice.voiceModeEnable')
      }
      side="top"
    >
      <Button
        type="button"
        variant={enabled ? 'secondary' : 'ghost'}
        size="icon"
        onClick={() => {
          if (!available) return;
          onChange(!enabled);
        }}
        disabled={disabled}
        // `aria-disabled` (not native `disabled`) for the not-configured case
        // so the button stays hoverable/focusable and the explanatory Tooltip
        // can still fire; the click handler already no-ops while unavailable.
        aria-disabled={!available || undefined}
        aria-pressed={enabled}
        aria-label={t('voice.voiceModeLabel')}
        className={cn(
          'focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:ring-inset',
          enabled && 'bg-primary/10 text-primary hover:bg-primary/15',
          !available && 'cursor-not-allowed opacity-50',
        )}
      >
        {enabled ? (
          <Volume2 aria-hidden className="size-4" />
        ) : (
          <VolumeOff aria-hidden className="size-4" />
        )}
      </Button>
    </Tooltip>
  );
}
