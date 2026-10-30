'use client';

import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { TeamsTable } from '@/app/features/settings/teams/components/teams-table';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useListReadRecovery } from '@/app/hooks/use-list-read-recovery';
import { useT } from '@/lib/i18n/client';

interface TeamsSettingsProps {
  organizationId: string;
}

// =============================================================================
// Teams settings page — renders the REAL section header above the Teams
// table on every state (cold, warm, loaded). Members live on the Organization
// page, so this page is now a single Teams table; the table owns its own
// count-aware loading skeleton (via the DataTable state machine), so there is
// no separate page-skeleton to drift from this layout.
//
// A failed read is never a skeleton that never ends (#4653): with no team
// loaded the table shows its error state with Try again, which moves the
// focus to the section before the table turns back into its loading state;
// rows a failed refresh left stay, and the failure is named above them.
// =============================================================================
export function TeamsSettings({ organizationId }: TeamsSettingsProps) {
  const { t: tSettings } = useT('settings');
  const { t: tNav } = useT('navigation');
  const { t: tAccess } = useT('accessDenied');
  const { teams, error, retry, retrying, failureCount } = useOrgTeams();
  const { regionRef, retryRead, focusRegion, failedWithRows } =
    useListReadRecovery<HTMLElement>({
      error,
      results: teams ?? [],
      retry,
    });

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  // Access is only knowable once the ability has loaded; until then the real
  // page (with its self-skeletonizing table) stands in — no denied-flash on
  // warm entry.
  if (!abilityLoading && ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccess('organization')} />;
  }

  return (
    <SettingsPage>
      <SettingsSection
        ref={regionRef}
        tabIndex={-1}
        className="outline-none"
        title={tNav('teams')}
        description={tSettings('teams.sectionDescription')}
      >
        {failedWithRows && (
          <CatalogLoadError
            // Each failure is announced again; Try again keeps its node, and
            // the focus on it, while a retry runs and when it fails again.
            failureKey={failureCount}
            onFocusLost={focusRegion}
            message={tSettings('teams.refreshFailed')}
            onRetry={retry}
            isRetrying={retrying}
          />
        )}
        <TeamsTable
          teams={teams}
          organizationId={organizationId}
          error={error}
          onRetry={retryRead}
          onErrorFocusLost={focusRegion}
        />
      </SettingsSection>
    </SettingsPage>
  );
}
