'use client';

import { Button } from '@tale/ui/button';
import { Mic } from 'lucide-react';
import { useCallback, useEffect, useRef, memo } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useSpeechToText } from '../hooks/use-speech-to-text';

interface DictationButtonProps {
  disabled?: boolean;
  lang?: string;
  onTranscript: (transcript: string) => void;
}

function DictationButtonComponent({
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

  const { isListening, isSupported, error, startListening, stopListening } =
    useSpeechToText({
      lang,
      onTranscript: handleTranscript,
    });

  const prevErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      const message =
        error === 'not-allowed'
          ? t('dictation.permissionDenied')
          : t('dictation.notSupported');
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

  return (
    <Tooltip
      content={isListening ? t('dictation.stop') : t('dictation.start')}
      side="top"
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={handleClick}
        disabled={disabled}
        aria-label={isListening ? t('dictation.stop') : t('dictation.start')}
        aria-pressed={isListening}
        className="relative rounded-full"
      >
        <Mic className={cn('size-4', isListening && 'text-destructive')} />
        {isListening && (
          <span
            className="bg-destructive absolute top-1 right-1 size-2 animate-pulse rounded-full"
            aria-hidden="true"
          />
        )}
      </Button>
    </Tooltip>
  );
}

export const DictationButton = memo(DictationButtonComponent);
