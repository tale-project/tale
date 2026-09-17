import { Button } from '@tale/ui/button';
import { Dialog } from '@tale/ui/dialog/dialog';

import { useT } from '@/lib/i18n/client';

import {
  transcriptionNeedsRetry,
  transcriptionUnavailableKey,
} from '../utils/transcription-availability';

interface TranscriptionSetupAction {
  label: string;
  onClick: () => void;
}

/** Recovery for an attempted transcription, never an idle configuration warning. */
export function TranscriptionAvailabilityNotice({
  open,
  onOpenChange,
  reason,
  setupAction,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason?: string;
  setupAction?: TranscriptionSetupAction;
  onRetry?: () => void;
}) {
  const { t } = useT('chat');
  const { t: tCommon } = useT('common');
  const temporary = transcriptionNeedsRetry(reason);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(transcriptionUnavailableKey(reason))}
      description={
        !temporary && !setupAction ? t('transcription.askAdmin') : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {tCommon('actions.close')}
          </Button>
          {temporary && onRetry ? (
            <Button
              onClick={() => {
                onOpenChange(false);
                onRetry();
              }}
            >
              {t('transcription.retry')}
            </Button>
          ) : setupAction ? (
            <Button
              onClick={() => {
                onOpenChange(false);
                setupAction.onClick();
              }}
            >
              {setupAction.label}
            </Button>
          ) : null}
        </>
      }
    />
  );
}
