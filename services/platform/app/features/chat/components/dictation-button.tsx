'use client';

import { Button } from '@tale/ui/button';
import { Loader2, Mic } from 'lucide-react';
import { useCallback, useEffect, useRef, memo } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useMediaRecorderDictation } from '../hooks/use-media-recorder-dictation';
import { useSpeechToText } from '../hooks/use-speech-to-text';

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

  const prevErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      let message: string;
      if (error === 'not-allowed') {
        message = t('dictation.permissionDenied');
      } else if (error === 'transcription-failed') {
        message = t('dictation.transcriptionFailed');
      } else {
        message = t('dictation.notSupported');
      }
      toast({ title: message, variant: 'destructive' });
    }
    prevErrorRef.current = error;
  }, [error, t]);

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

  return (
    <Tooltip content={tooltipContent} side="top">
      <Button
        variant="ghost"
        size="icon"
        onClick={handleClick}
        disabled={disabled || isTranscribing}
        aria-label={ariaLabel}
        aria-busy={isTranscribing}
        aria-pressed={isListening}
        className="relative rounded-full"
      >
        {isTranscribing ? (
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <Mic className={cn('size-4', isListening && 'text-destructive')} />
        )}
        {isListening && (
          <span
            className="bg-destructive absolute top-1 right-1 size-2 animate-pulse rounded-full motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
      </Button>
    </Tooltip>
  );
}

export const DictationButton = memo(DictationButtonComponent);
