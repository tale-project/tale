'use client';

import { Button } from '@tale/ui/button';
import { Loader2, Mic } from 'lucide-react';
import { useCallback, useEffect, useRef, memo } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useMediaRecorderDictation } from '../hooks/use-media-recorder-dictation';
import { useMicrophoneLevel } from '../hooks/use-microphone-level';
import { useSpeechToText } from '../hooks/use-speech-to-text';
import {
  playDictationStartSound,
  playDictationStopSound,
} from '../utils/dictation-sounds';

interface DictationButtonProps {
  organizationId: string;
  disabled?: boolean;
  lang?: string;
  onTranscript: (transcript: string) => void;
}

function DictationButtonComponent({
  organizationId,
  disabled = false,
  lang,
  onTranscript,
}: DictationButtonProps) {
  const { t } = useT('chat');

  const handleTranscript = useCallback(
    (transcript: string) => {
      onTranscript(transcript);
    },
    [onTranscript],
  );

  // Prefer the Web Speech API (in-browser, free, lower latency). Fall back
  // to MediaRecorder + server-Whisper for browsers that don't ship the
  // Web Speech API (notably Firefox).
  const speech = useSpeechToText({
    lang,
    onTranscript: handleTranscript,
  });

  const useFallback = !speech.isSupported;

  const recorder = useMediaRecorderDictation({
    organizationId,
    onTranscript: handleTranscript,
  });

  const isListening = useFallback ? recorder.isListening : speech.isListening;
  const isTranscribing = useFallback ? recorder.isTranscribing : false;
  const isSupported = useFallback ? recorder.isSupported : true;
  const error = useFallback ? recorder.error : speech.error;
  const startListening = useFallback
    ? recorder.startListening
    : speech.startListening;
  const stopListening = useFallback
    ? recorder.stopListening
    : speech.stopListening;

  const level = useMicrophoneLevel({ enabled: isListening });

  const prevErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      // Map only known error codes to user-facing messages. Unknown codes
      // (notably transient Web Speech codes like "network" or
      // "service-not-allowed") get logged but not toasted as
      // "not supported", which would be wrong and confusing.
      let message: string | null = null;
      if (error === 'not-allowed' || error === 'audio-capture') {
        message = t('dictation.permissionDenied');
      } else if (error === 'transcription-failed') {
        message = t('dictation.transcriptionFailed');
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

  if (!isSupported) return null;

  const handleClick = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const tooltipContent = isTranscribing
    ? t('dictation.transcribing')
    : isListening
      ? t('dictation.stop')
      : t('dictation.start');

  const ariaLabel = isTranscribing
    ? t('dictation.transcribing')
    : isListening
      ? t('dictation.stop')
      : t('dictation.start');

  // Map the 0..1 level into a CSS percent for the volume bar. The bar
  // sits inside the pill button when listening; clamp at 100 so a brief
  // peak can't visually overflow.
  const levelPercent = Math.round(Math.min(1, Math.max(0, level)) * 100);

  return (
    <Tooltip content={tooltipContent} side="top">
      <Button
        variant={isListening ? 'destructive' : 'ghost'}
        size={isListening ? 'sm' : 'icon'}
        onClick={handleClick}
        disabled={disabled || isTranscribing}
        aria-label={ariaLabel}
        aria-busy={isTranscribing}
        aria-pressed={isListening}
        className={cn('relative rounded-full', isListening && 'gap-2 px-3')}
      >
        {isTranscribing ? (
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <Mic
            className={cn(
              'size-4',
              isListening && 'animate-pulse motion-reduce:animate-none',
            )}
          />
        )}
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
}

export const DictationButton = memo(DictationButtonComponent);
