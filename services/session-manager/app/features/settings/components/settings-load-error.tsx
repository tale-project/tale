import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';

import { readFailureText } from '@/app/lib/api/failure';
import { useT } from '@/lib/i18n/client';

interface SettingsLoadErrorProps {
  error: unknown;
  onRetry: () => void;
  isRetrying: boolean;
  /** Changes with every failed attempt, so each one is announced again. */
  failureKey: number;
}

/** The settings could not be read: what happened, and a way to try again. */
export function SettingsLoadError({
  error,
  onRetry,
  isRetrying,
  failureKey,
}: SettingsLoadErrorProps) {
  const { t } = useT('settings');
  const { t: tErrors } = useT('errors');
  return (
    <CatalogLoadError
      message={readFailureText(t('loadFailed'), error, tErrors)}
      onRetry={onRetry}
      isRetrying={isRetrying}
      failureKey={failureKey}
    />
  );
}
