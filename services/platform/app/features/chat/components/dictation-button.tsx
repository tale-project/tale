'use client';

import { Button } from '@tale/ui/button';
import { Mic } from 'lucide-react';
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useMicrophoneLevel } from '../hooks/use-microphone-level';
import { useSpeechToText } from '../hooks/use-speech-to-text';
import {
  playDictationStartSound,
  playDictationStopSound,
} from '../utils/dictation-sounds';

interface DictationButtonProps {
  disabled?: boolean;
  /** BCP-47 tag the recognizer listens in. */
  lang?: string;
  onTranscript: (transcript: string) => void;
}

export interface DictationButtonHandle {
  /** Stop an in-progress dictation, if any (e.g. when the message is sent). */
  stop: () => void;
}

/**
 * Push-to-talk dictation on the browser's Web Speech API: in-browser, free,
 * low latency. Start/stop tones and a live microphone-level bar confirm the
 * mic state without requiring eyes on the button.
 *
 * Browsers without the API (notably Firefox) render no button at all. The
 * old MediaRecorder + server-transcription fallback stays retired until the
 * rewritten AI backend serves `transcribeDictation` again — today that
 * action refuses every request, so offering a mic that records, uploads,
 * and then fails would be a false affordance.
 */
const DictationButtonComponent = forwardRef<
  DictationButtonHandle,
  DictationButtonProps
>(function DictationButtonComponent(
  { disabled = false, lang, onTranscript },
  ref,
) {
  const { t } = useT('chat');

  const { isListening, isSupported, error, startListening, stopListening } =
    useSpeechToText({ lang, onTranscript });

  const level = useMicrophoneLevel({ enabled: isListening });

  const prevErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      // Map only known error codes to user-facing messages. Unknown codes
      // (notably transient Web Speech codes like "network" or
      // "service-not-allowed") get logged but not toasted as "not
      // supported", which would be wrong and confusing.
      let message: string | null = null;
      if (error === 'not-allowed' || error === 'audio-capture') {
        message = t('dictation.permissionDenied');
      } else if (
        error === 'not-supported' ||
        error === 'language-not-supported'
      ) {
        message = t('dictation.notSupported');
      } else {
        console.warn('[dictation] unhandled error code:', error);
      }
      if (message) {
        toast({ title: message, variant: 'destructive' });
      }
    }
    prevErrorRef.current = error;
  }, [error, t]);

  // Edge-detect the listening state so we play start/stop tones once per
  // transition. We intentionally skip the first render (no transition).
  const prevListeningRef = useRef(isListening);
  useEffect(() => {
    if (prevListeningRef.current === isListening) return;
    if (isListening) {
      playDictationStartSound();
    } else {
      playDictationStopSound();
    }
    prevListeningRef.current = isListening;
  }, [isListening]);

  // Let the parent (the composer) stop an active dictation when the message
  // is sent, so the mic doesn't keep listening after send.
  useImperativeHandle(
    ref,
    () => ({
      stop: () => {
        if (isListening) stopListening();
      },
    }),
    [isListening, stopListening],
  );

  if (!isSupported) return null;

  const handleClick = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const label = isListening ? t('dictation.stop') : t('dictation.start');

  // Map the 0..1 level into a CSS percent for the volume bar. The bar sits
  // inside the pill button when listening; clamp at 100 so a brief peak
  // can't visually overflow.
  const levelPercent = Math.round(Math.min(1, Math.max(0, level)) * 100);

  return (
    <Tooltip content={label} side="top">
      <Button
        variant={isListening ? 'destructive' : 'ghost'}
        size={isListening ? 'sm' : 'icon'}
        onClick={handleClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={isListening}
        className={cn(
          'focus-visible:ring-ring relative rounded-full focus-visible:ring-2 focus-visible:ring-inset',
          isListening && 'gap-2 px-3',
        )}
      >
        <Mic
          className={cn(
            'size-4',
            isListening && 'animate-pulse motion-reduce:animate-none',
          )}
        />
        {isListening && (
          <span
            className="bg-destructive-foreground/30 relative h-1.5 w-12 overflow-hidden rounded-full"
            role="progressbar"
            aria-label={t('dictation.level')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={levelPercent}
          >
            <span
              className="bg-destructive-foreground absolute inset-y-0 left-0 rounded-full transition-[width] duration-75 ease-out"
              style={{ width: `${levelPercent}%` }}
              aria-hidden="true"
            />
          </span>
        )}
      </Button>
    </Tooltip>
  );
});

export const DictationButton = memo(DictationButtonComponent);
