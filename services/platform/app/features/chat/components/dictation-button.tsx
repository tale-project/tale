'use client';

import { Button } from '@tale/ui/button';
import { AlertCircle, Loader2, Mic, RotateCcw, X } from 'lucide-react';
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useMediaRecorderDictation } from '../hooks/use-media-recorder-dictation';
import { useMicrophoneLevel } from '../hooks/use-microphone-level';
import { useSpeechToText } from '../hooks/use-speech-to-text';
import { useVoiceCapabilities } from '../hooks/use-voice-capabilities';
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

export interface DictationButtonHandle {
  /** Stop an in-progress recording, if any (e.g. when the message is sent). */
  stop: () => void;
}

const DictationButtonComponent = forwardRef<
  DictationButtonHandle,
  DictationButtonProps
>(function DictationButtonComponent(
  { organizationId, disabled = false, lang, onTranscript },
  ref,
) {
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

  // Failed-recording recovery only exists on the MediaRecorder fallback
  // (the Web Speech path has no server round-trip to fail or retry).
  const hasFailedRecording = useFallback && recorder.hasFailedRecording;

  // The server fallback (Firefox & co.) transcribes via a provider's
  // `transcription` model. When none is configured, disable the mic with an
  // explanatory tooltip instead of letting the user record → upload → fail.
  // The Web Speech path needs no provider, so this only gates the fallback.
  const { hasTranscription, isLoading: capsLoading } =
    useVoiceCapabilities(organizationId);
  const transcriptionUnavailable =
    useFallback && !capsLoading && !hasTranscription;

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
        // Surfaced by the persistent failed-dictation pill (with retry /
        // discard) instead of a transient toast — mirrors the video-link
        // "chip not toast" pattern. No toast here.
        message = null;
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

  // Let the parent (chat input) stop an active recording when the message is
  // sent, so the mic doesn't keep listening after send (#1462).
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
    if (transcriptionUnavailable) return;
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const tooltipContent = transcriptionUnavailable
    ? t('dictation.notConfigured')
    : isTranscribing
      ? t('dictation.transcribing')
      : isListening
        ? t('dictation.stop')
        : t('dictation.start');

  const ariaLabel = transcriptionUnavailable
    ? t('dictation.notConfigured')
    : isTranscribing
      ? t('dictation.transcribing')
      : isListening
        ? t('dictation.stop')
        : t('dictation.start');

  // Map the 0..1 level into a CSS percent for the volume bar. The bar
  // sits inside the pill button when listening; clamp at 100 so a brief
  // peak can't visually overflow.
  const levelPercent = Math.round(Math.min(1, Math.max(0, level)) * 100);

  return (
    <span className="flex items-center gap-1">
      <Tooltip content={tooltipContent} side="top">
        <Button
          variant={isListening ? 'destructive' : 'ghost'}
          size={isListening ? 'sm' : 'icon'}
          onClick={handleClick}
          disabled={disabled || isTranscribing}
          // `aria-disabled` (not native `disabled`) for the not-configured case
          // so the explanatory Tooltip still fires on hover/focus; handleClick
          // already no-ops while unavailable.
          aria-disabled={transcriptionUnavailable || undefined}
          aria-label={ariaLabel}
          aria-busy={isTranscribing}
          aria-pressed={isListening}
          className={cn(
            'relative rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
            isListening && 'gap-2 px-3',
            transcriptionUnavailable && 'cursor-not-allowed opacity-50',
          )}
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
      {hasFailedRecording && !isTranscribing && (
        // Persistent recovery affordance: the failed recording is held in
        // memory so the user can fix their provider and retry without
        // re-recording. Discard drops the retained audio.
        <span className="border-destructive/40 bg-destructive/5 text-destructive flex items-center gap-1 rounded-full border px-2 py-1 text-xs">
          <AlertCircle className="size-3 shrink-0" aria-hidden="true" />
          <span>{t('dictation.transcriptionFailedShort')}</span>
          <button
            type="button"
            aria-label={t('dictation.retry')}
            title={t('dictation.retry')}
            onClick={recorder.retryTranscription}
            className="hover:bg-destructive/10 flex size-6 items-center justify-center rounded-full transition-colors"
          >
            <RotateCcw className="size-3" />
          </button>
          <button
            type="button"
            aria-label={t('dictation.discard')}
            title={t('dictation.discard')}
            onClick={recorder.discardFailedRecording}
            className="hover:bg-destructive/10 flex size-6 items-center justify-center rounded-full transition-colors"
          >
            <X className="size-3" />
          </button>
        </span>
      )}
    </span>
  );
});

export const DictationButton = memo(DictationButtonComponent);
