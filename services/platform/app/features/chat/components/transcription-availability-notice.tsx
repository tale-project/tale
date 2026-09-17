import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { TriangleAlert } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import {
  transcriptionNeedsRetry,
  transcriptionUnavailableKey,
} from '../utils/transcription-availability';

export interface TranscriptionSetupAction {
  label: string;
  onClick: () => void;
}

/** Kept visible before selecting a file or recording, without disabling text. */
export function TranscriptionAvailabilityNotice({
  reason,
  setupAction,
  onRetry,
}: {
  reason?: string;
  setupAction?: TranscriptionSetupAction;
  onRetry?: () => void;
}) {
  const { t } = useT('chat');
  const temporary = transcriptionNeedsRetry(reason);
  return (
    <Row gap={2} align="start" wrap className="pb-3">
      <TriangleAlert
        aria-hidden
        className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
      />
      <Text variant="muted" className="min-w-0 flex-1 text-xs">
        {t(transcriptionUnavailableKey(reason))}
        {!temporary && !setupAction && ` ${t('transcription.askAdmin')}`}
      </Text>
      {temporary && onRetry ? (
        <Button variant="link" size="sm" onClick={onRetry}>
          {t('transcription.retry')}
        </Button>
      ) : setupAction ? (
        <Button variant="link" size="sm" onClick={setupAction.onClick}>
          {setupAction.label}
        </Button>
      ) : null}
    </Row>
  );
}
