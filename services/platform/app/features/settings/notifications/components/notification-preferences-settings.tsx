'use client';

import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useToast } from '@tale/ui/use-toast';
import { useCallback, useRef, type ReactNode, type Ref } from 'react';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import { useAbility } from '@/app/hooks/use-ability';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { readStateOf } from '@/app/lib/backend/read-state';
import { useT } from '@/lib/i18n/client';
import { backendErrorMessage } from '@/lib/utils/backend-error';

import { useSetNotificationPreferences } from '../hooks/mutations';
import { useNotificationPreferences } from '../hooks/queries';

type InAppPrefKey =
  | 'taskAssigned'
  | 'taskStatusChanged'
  | 'taskCommented'
  | 'mention'
  | 'taskDeadlines'
  | 'taskReview'
  | 'escalation'
  | 'automationAlerts'
  | 'automationMessages'
  | 'conversationMessages';

const IN_APP_PREF_KEYS: InAppPrefKey[] = [
  'taskAssigned',
  'taskStatusChanged',
  'taskCommented',
  'mention',
  'taskDeadlines',
  'taskReview',
  'escalation',
  'automationAlerts',
  'automationMessages',
  'conversationMessages',
];

/** Toggles for notices only owners and admins receive — a paused schedule
 * is theirs to fix — so nobody else is offered a switch that does nothing. */
const ADMIN_ONLY_PREF_KEYS: ReadonlySet<InAppPrefKey> = new Set([
  'automationAlerts',
]);

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
  const { t } = useT('notificationPreferences');
  const preferences = useNotificationPreferences(organizationId);
  const { data, refetch } = preferences;
  // A switch states what the person chose, so a read that failed is named,
  // never shown as every switch on (#4653). The flags hold through a retry,
  // which react-query starts from `pending`.
  const read = readStateOf(preferences);
  // Where a Try again that gave way hands its focus: the section the
  // switches come back in.
  const sectionRef = useRef<HTMLElement>(null);
  const focusSection = useCallback(() => sectionRef.current?.focus(), []);

  return (
    // Masked until the read answers: while it loads, and while an offline
    // browser holds it back — react-query pauses it, so `isLoading` is false
    // with nothing read.
    <Skeletonize loading={data === undefined && !read.unavailable}>
      <NotificationPreferencesSettingsView
        organizationId={organizationId}
        prefs={data}
        unavailable={read.unavailable}
        sectionRef={sectionRef}
        readFailure={
          read.unavailable || read.stale ? (
            <CatalogLoadError
              // Each failure is announced again; Try again keeps its node,
              // and the focus on it, through a retry that fails again.
              failureKey={read.failureCount}
              message={t(read.stale ? 'refreshFailed' : 'loadFailed')}
              onRetry={() => void refetch()}
              isRetrying={read.retrying}
              onFocusLost={focusSection}
            />
          ) : undefined
        }
      />
    </Skeletonize>
  );
}

function NotificationPreferencesSettingsView({
  organizationId,
  prefs,
  unavailable,
  sectionRef,
  readFailure,
}: {
  organizationId: string;
  /** The read never answered: no switch is shown, only `readFailure`. */
  unavailable: boolean;
  sectionRef: Ref<HTMLElement>;
  /** The failed read's notice, above the switches. */
  readFailure: ReactNode;
  prefs:
    | {
        taskAssigned?: boolean;
        taskStatusChanged?: boolean;
        taskCommented?: boolean;
        mention?: boolean;
        taskDeadlines?: boolean;
        taskReview?: boolean;
        escalation?: boolean;
        automationAlerts?: boolean;
        automationMessages?: boolean;
        digest?: boolean;
        conversationMessages?: boolean;
        actionableEmail?: boolean;
      }
    | undefined;
}) {
  const { t } = useT('notificationPreferences');
  const { toast } = useToast();
  const ability = useAbility();
  const isAdmin = ability.can('read', 'orgSettings');
  const prefKeys = isAdmin
    ? IN_APP_PREF_KEYS
    : IN_APP_PREF_KEYS.filter((key) => !ADMIN_ONLY_PREF_KEYS.has(key));
  // A switch states a choice; with nothing read, none is shown.
  const shownKeys = unavailable ? [] : prefKeys;
  const { mutateAsync: save, isPending } = useSetNotificationPreferences();

  const handleToggle = useCallback(
    async (key: InAppPrefKey | 'actionableEmail', checked: boolean) => {
      if (isPending) return;
      try {
        await save({
          organizationId,
          [key]: checked,
        });
      } catch (err) {
        toast({
          title: t('saveFailed'),
          description: backendErrorMessage(err, t('saveFailed')),
          variant: 'destructive',
        });
      }
    },
    [isPending, organizationId, save, t, toast],
  );

  const emailChecked = prefs?.actionableEmail !== false;

  return (
    <SettingsPage>
      {!unavailable && (
        <SettingsSection
          title={t('deliveryTitle')}
          description={t('deliveryDescription')}
        >
          <SettingsToggleRow
            label={t('fields.actionableEmail.label')}
            description={t('fields.actionableEmail.description')}
            checked={emailChecked}
            ariaBusy={isPending}
            onCheckedChange={(next) =>
              void handleToggle('actionableEmail', next)
            }
          />
        </SettingsSection>
      )}
      <SettingsSection
        ref={sectionRef}
        tabIndex={-1}
        className="outline-none"
        title={t('title')}
        description={t('description')}
      >
        {readFailure}
        {shownKeys.map((key) => {
          // Review requests are a safety signal — the section description
          // above already promises they "always stay on"; back that promise
          // with a locked control instead of a toggle that quietly breaks it
          // once flipped off (#2651).
          const isLockedOn = key === 'taskReview';
          const value = prefs?.[key];
          const checked = isLockedOn ? true : value !== false;
          return (
            <SettingsToggleRow
              key={key}
              label={t(`fields.${key}.label`)}
              description={
                isLockedOn
                  ? `${t('fields.taskReview.description')} ${t('fields.taskReview.lockedHint')}`
                  : t(`fields.${key}.description`)
              }
              checked={checked}
              disabled={isLockedOn}
              ariaBusy={isPending}
              onCheckedChange={(next) => void handleToggle(key, next)}
            />
          );
        })}
      </SettingsSection>
    </SettingsPage>
  );
}
