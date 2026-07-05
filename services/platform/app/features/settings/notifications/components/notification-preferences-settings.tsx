'use client';

import { Skeletonize } from '@tale/ui/skeleton-context';
import { useCallback } from 'react';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { convexErrorMessage } from '@/lib/utils/convex-error';

import { useSetNotificationPreferences } from '../hooks/mutations';
import { useNotificationPreferences } from '../hooks/queries';

type InAppPrefKey =
  | 'taskAssigned'
  | 'taskStatusChanged'
  | 'taskCommented'
  | 'mention'
  | 'taskReview'
  | 'escalation'
  | 'automationAlerts'
  | 'digest'
  | 'conversationMessages';

const IN_APP_PREF_KEYS: InAppPrefKey[] = [
  'taskAssigned',
  'taskStatusChanged',
  'taskCommented',
  'mention',
  'taskReview',
  'escalation',
  'automationAlerts',
  'digest',
  'conversationMessages',
];

export function NotificationPreferencesSettings() {
  const organizationId = useOrganizationId();
  if (!organizationId) return null;
  return (
    <NotificationPreferencesSettingsInner organizationId={organizationId} />
  );
}

function NotificationPreferencesSettingsInner({
  organizationId,
}: {
  organizationId: string;
}) {
  const { data, isLoading } = useNotificationPreferences(organizationId);

  return (
    <Skeletonize loading={isLoading}>
      <NotificationPreferencesSettingsView
        organizationId={organizationId}
        prefs={data}
      />
    </Skeletonize>
  );
}

function NotificationPreferencesSettingsView({
  organizationId,
  prefs,
}: {
  organizationId: string;
  prefs:
    | {
        taskAssigned?: boolean;
        taskStatusChanged?: boolean;
        taskCommented?: boolean;
        mention?: boolean;
        taskReview?: boolean;
        escalation?: boolean;
        automationAlerts?: boolean;
        digest?: boolean;
        conversationMessages?: boolean;
        actionableEmail?: boolean;
      }
    | undefined;
}) {
  const { t } = useT('notificationPreferences');
  const { toast } = useToast();
  const { mutateAsync: save, isPending } = useSetNotificationPreferences();

  const handleToggle = useCallback(
    async (key: InAppPrefKey | 'actionableEmail', checked: boolean) => {
      try {
        await save({
          organizationId,
          [key]: checked,
        });
      } catch (err) {
        toast({
          title: t('saveFailed'),
          description: convexErrorMessage(err, t('saveFailed')),
          variant: 'destructive',
        });
      }
    },
    [organizationId, save, t, toast],
  );

  const emailChecked = prefs?.actionableEmail !== false;

  return (
    <SettingsPage>
      <SettingsSection
        title={t('deliveryTitle')}
        description={t('deliveryDescription')}
      >
        <SettingsToggleRow
          label={t('fields.actionableEmail.label')}
          description={t('fields.actionableEmail.description')}
          checked={emailChecked}
          disabled={isPending}
          ariaBusy={isPending}
          onCheckedChange={(next) => void handleToggle('actionableEmail', next)}
        />
      </SettingsSection>
      <SettingsSection title={t('title')} description={t('description')}>
        {IN_APP_PREF_KEYS.map((key) => {
          const value = prefs?.[key];
          const checked = value !== false;
          return (
            <SettingsToggleRow
              key={key}
              label={t(`fields.${key}.label`)}
              description={t(`fields.${key}.description`)}
              checked={checked}
              disabled={isPending}
              ariaBusy={isPending}
              onCheckedChange={(next) => void handleToggle(key, next)}
            />
          );
        })}
      </SettingsSection>
    </SettingsPage>
  );
}
