'use client';

import { Button } from '@tale/ui/button';
import { AlertCircle, Loader2, Mic, RotateCcw, X } from 'lucide-react';
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

import { useMediaRecorderDictation } from '../hooks/use-media-recorder-dictation';
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
  /** The org the MediaRecorder fallback transcribes (and bills) against.
   * Without it the fallback stays off and only Web Speech can render. */
  organizationId?: string;
  /** A `transcription`-capable model is configured for the org (resolved by
   * the composer catalog walk, `voice.transcriptionAvailable`). Gates the
   * MediaRecorder fallback BEFORE recording — a mic that records, uploads,
   * and then fails would be a false affordance. */
  transcriptionAvailable?: boolean;
}

export interface DictationButtonHandle {
  /** Stop an in-progress dictation, if any (e.g. when the message is sent). */
  stop: () => void;
}

/**
 * Push-to-talk dictation. Prefers the browser's Web Speech API (in-browser,
 * free, low latency); browsers without it (notably Firefox) fall back to
 * MediaRecorder + server transcription via `transcribeDictation`, gated on
 * `transcriptionAvailable` so the mic only renders when the round-trip can
 * succeed. When neither path is available, no button renders at all.
 *
 * Start/stop tones and a live microphone-level bar confirm the mic state
 * without requiring eyes on the button. The fallback adds a "Transcribing…"
 * spinner for its post-stop round-trip, and a failed round-trip keeps the
 * recording in memory behind a persistent retry/discard pill.
 */
const DictationButtonComponent = forwardRef<
  DictationButtonHandle,
  DictationButtonProps
>(function DictationButtonComponent(
  {
    disabled = false,
    lang,
    onTranscript,
    organizationId,
    transcriptionAvailable,
  },
  ref,
) {
  const { t } = useT('chat');

  const speech = useSpeechToText({ lang, onTranscript });

  // Prefer the Web Speech API; fall back to MediaRecorder + server
  // transcription for browsers that don't ship it (notably Firefox).
  const useFallback = !speech.isSupported;

  const recorder = useMediaRecorderDictation({
    // The fallback only activates when `fallbackReady` below holds, which
    // requires `organizationId` — the placeholder can never reach the action.
    organizationId: organizationId ?? '',
    onTranscript,
  });

  // The server fallback needs the recorder, a transcription-capable model
  // (known BEFORE recording), and the org to authorize against.
  const fallbackReady =
    recorder.isSupported &&
    transcriptionAvailable === true &&
    organizationId !== undefined;

  const isListening = useFallback ? recorder.isListening : speech.isListening;
  const isTranscribing = useFallback ? recorder.isTranscribing : false;
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
      } else if (error === 'transcription-failed') {
        // Surfaced by the persistent failed-dictation pill (with retry /
        // discard) instead of a transient toast. No toast here.
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

  // No Web Speech and the org CONFIRMED without a transcription model: the
  // mic renders disabled with the "ask an admin" explanation (the 0.3
  // treatment) — hiding it entirely would leave no trace that dictation
  // exists to be configured. An UNKNOWN availability (catalog still
  // answering, or a surface without the wiring) renders nothing rather than
  // flashing a claim that may be wrong a beat later; a browser whose
  // recorder cannot capture at all has nothing to explain.
  if (useFallback && !fallbackReady) {
    const confirmedUnavailable =
      recorder.isSupported &&
      organizationId !== undefined &&
      transcriptionAvailable === false;
    if (!confirmedUnavailable) return null;
    return (
      <Tooltip content={t('dictation.notConfigured')} side="top">
        <Button
          variant="ghost"
          size="icon"
          // `aria-disabled` (not native `disabled`) so the button stays
          // hoverable/focusable and the explanatory tooltip can fire.
          aria-disabled
          aria-label={t('dictation.notConfigured')}
          className="focus-visible:ring-ring cursor-not-allowed rounded-full opacity-50 focus-visible:ring-2 focus-visible:ring-inset"
        >
          <Mic className="size-4" />
        </Button>
      </Tooltip>
    );
  }

  const handleClick = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const label = isTranscribing
    ? t('dictation.transcribing')
    : isListening
      ? t('dictation.stop')
      : t('dictation.start');

  // Map the 0..1 level into a CSS percent for the volume bar. The bar sits
  // inside the pill button when listening; clamp at 100 so a brief peak
  // can't visually overflow.
  const levelPercent = Math.round(Math.min(1, Math.max(0, level)) * 100);

  return (
    <span className="flex items-center gap-1">
      <Tooltip content={label} side="top">
        <Button
          variant={isListening ? 'destructive' : 'ghost'}
          size={isListening ? 'sm' : 'icon'}
          onClick={handleClick}
          disabled={disabled || isTranscribing}
          aria-label={label}
          aria-busy={isTranscribing}
          aria-pressed={isListening}
          className={cn(
            'focus-visible:ring-ring relative rounded-full focus-visible:ring-2 focus-visible:ring-inset',
            isListening && 'gap-2 px-3',
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
      {hasFailedRecording &&
        !isTranscribing && (
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
