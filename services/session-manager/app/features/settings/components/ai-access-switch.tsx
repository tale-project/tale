import { Skeletonize } from '@tale/ui/skeleton-context';

import { useT } from '@/lib/i18n/client';

import { useAiAccess } from '../hooks/use-ai-access';
import { SettingsLoadError } from './settings-load-error';
import { SettingsToggleRow } from './settings-toggle-row';

/**
 * The switch that lets assistants connect. A failed read replaces it with the
 * reason and a retry: an "off" shown for a state nobody read would be a claim.
 */
export function AiAccessSwitch() {
  const { t } = useT('settings');
  const { settings, enabled, isPending, setEnabled } = useAiAccess();

  if (settings.isError && settings.data === undefined) {
    return (
      <SettingsLoadError
        error={settings.error}
        onRetry={() => void settings.refetch()}
        isRetrying={settings.isFetching}
        failureKey={settings.errorUpdateCount}
      />
    );
  }

  return (
    <Skeletonize loading={settings.data === undefined}>
      <SettingsToggleRow
        label={t('aiAccess.switch.label')}
        description={t('aiAccess.switch.description')}
        checked={enabled ?? false}
        // Not `disabled` while the change is on its way: a focused control
        // that becomes disabled drops the keyboard focus. A second click
        // waits for the first instead.
        onCheckedChange={(next) => {
          if (!isPending) setEnabled(next);
        }}
        ariaBusy={isPending || undefined}
      />
    </Skeletonize>
  );
}
