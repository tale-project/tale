import { Button } from '@tale/ui/button';

import { Stack } from '@/app/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';

interface ConditionalAccessErrorProps {
  errorCode: string;
  errorMessage: string;
  recoveryKey?: string;
  onRetry: () => void;
}

export function ConditionalAccessError({
  errorCode,
  errorMessage,
  recoveryKey,
  onRetry,
}: ConditionalAccessErrorProps) {
  const { t } = useT('auth');

  const isMfaError = errorCode === 'AADSTS50076' || errorCode === 'AADSTS50079';
  const isBlockedError = errorCode === 'AADSTS53003';

  return (
    <Stack gap={4} className="text-center">
      <div role="alert" aria-live="assertive">
        <p className="text-destructive text-sm font-medium">
          {t(errorMessage)}
        </p>
        {recoveryKey && (
          <p className="text-muted-foreground mt-2 text-sm">{t(recoveryKey)}</p>
        )}
      </div>

      <Stack gap={2}>
        {isMfaError && (
          <Button onClick={onRetry} size="lg" fullWidth>
            {t('sso.actions.completeMfa')}
          </Button>
        )}

        {isBlockedError && (
          <p className="text-muted-foreground text-sm">
            {t('sso.actions.contactAdminMessage')}
          </p>
        )}

        {!isBlockedError && (
          <Button onClick={onRetry} variant="secondary" size="lg" fullWidth>
            {t('sso.actions.tryAgain')}
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
