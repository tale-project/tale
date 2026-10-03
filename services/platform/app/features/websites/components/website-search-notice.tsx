'use client';

import { Alert } from '@tale/ui/alert';
import { LinkButton } from '@tale/ui/button';
import { Text } from '@tale/ui/text';
import { Settings } from 'lucide-react';

import { useEmbeddingSetupNudge } from '@/app/features/settings/data-residency/components/embedding-setup-banner';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { useWebsiteSearchReadiness } from '../hooks/queries';

interface WebsiteSearchNoticeProps {
  organizationId: string;
}

/**
 * The Websites page's statement that chat cannot search what the crawl
 * stores. Every search embeds its query first, so without a working
 * embedding model a site reads Active with every page indexed while the
 * assistant answers that web-page search is not set up — and nothing on
 * this page said so.
 *
 * Shown only on a settled "not ready". A reader who can open the settings
 * gets the link; everyone else is pointed at an admin. Where the dashboard's
 * own banner (`EmbeddingSetupBanner`) already names the missing model, this
 * stays silent rather than saying it twice on one screen.
 */
export function WebsiteSearchNotice({
  organizationId,
}: WebsiteSearchNoticeProps) {
  const { data } = useWebsiteSearchReadiness(organizationId);
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  if (data?.ready !== false || abilityLoading) return null;
  // The gate sits outside the component that reads the settings: those
  // reads are admin doors.
  return ability.can('read', 'orgSettings') ? (
    <AdminSearchNotice organizationId={organizationId} />
  ) : (
    <SearchNotice organizationId={organizationId} canConfigure={false} />
  );
}

function AdminSearchNotice({ organizationId }: WebsiteSearchNoticeProps) {
  if (useEmbeddingSetupNudge(organizationId) !== 'hidden') return null;
  return <SearchNotice organizationId={organizationId} canConfigure />;
}

function SearchNotice({
  organizationId,
  canConfigure,
}: WebsiteSearchNoticeProps & { canConfigure: boolean }) {
  const { t } = useT('websites');
  return (
    // Static while it holds: it states a condition of the page, it does not
    // announce an event.
    <Alert
      variant="warning"
      live="off"
      title={t('searchNotice.title')}
      description={t('searchNotice.description')}
    >
      {canConfigure ? (
        <LinkButton
          variant="secondary"
          size="sm"
          icon={Settings}
          href="/dashboard/$id/settings/data-residency"
          params={{ id: organizationId }}
          className="mt-3 w-fit gap-1.5"
        >
          {t('searchNotice.configureCta')}
        </LinkButton>
      ) : (
        <Text variant="muted" className="mt-2">
          {t('searchNotice.askAdmin')}
        </Text>
      )}
    </Alert>
  );
}
