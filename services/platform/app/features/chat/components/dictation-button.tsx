'use client';

import { Mic } from 'lucide-react';
import { useCallback, memo } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useSpeechToText } from '../hooks/use-speech-to-text';

interface DictationButtonProps {
  disabled?: boolean;
  onTranscript: (transcript: string) => void;
}

function DictationButtonComponent({
  disabled = false,
  onTranscript,
}: DictationButtonProps) {
  const { t } = useT('chat');

  const handleTranscript = useCallback(
    (transcript: string) => {
      onTranscript(transcript);
    },
    [onTranscript],
  );

  const { isListening, isSupported, startListening, stopListening } =
    useSpeechToText({
      onTranscript: handleTranscript,
    });

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
        className="relative"
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
