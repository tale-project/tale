'use client';

import { Row } from '@tale/ui/layout';
import { Link } from '@tanstack/react-router';

import { useProviderCredentials } from '@/app/features/settings/providers/hooks/queries';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { useOrgKnowledgeEmbedding } from '../hooks/queries';

/**
 * Dashboard banner for the gap between "this org has an AI provider" and
 * "this org can use knowledge".
 *
 * An embedding model has no working default — `EmbeddingNotConfigured` is a
 * refusal, never a guess — so an organization that never sets one has a
 * knowledge base that cannot index or search. Until now the only places that
 * said so were the settings page itself and the error on a document that had
 * already failed to index, which is after the reader spent the upload.
 *
 * Not dismissible, and deliberately so: the state it reports is a broken
 * knowledge base, and it clears the moment a model is configured. Two gates
 * keep it from being noise:
 *
 *  - **Only once a provider exists.** With no credential there is nothing to
 *    choose a model with, and the setup wizard is already asking for one; a
 *    second nudge at that moment would just be noise on an empty org.
 *  - **Only for a reader who can act.** Viewing data residency needs
 *    `read orgSettings`, so a member who cannot open the page never sees it.
 *
 * Mirrors `TwoFactorLowBackupCodesBanner`'s structure — same row, same warning
 * tint, same trailing link — so every dashboard-level nudge reads the same.
 */
export function EmbeddingSetupBanner({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('settings');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const embeddingQuery = useOrgKnowledgeEmbedding(organizationId);
  const credentialsQuery = useProviderCredentials(organizationId);

  if (abilityLoading || ability.cannot('read', 'orgSettings')) return null;
  // A failed or still-loading read is not evidence of a missing model. Saying
  // "knowledge search is off" on an unknown state is worse than saying nothing.
  if (embeddingQuery.data === undefined || embeddingQuery.isError) return null;
  if (embeddingQuery.data.configured) return null;
  if ((credentialsQuery.data ?? []).length === 0) return null;

  return (
    <Row
      role="status"
      gap={2}
      wrap
      className="bg-warning/10 border-warning/30 shrink-0 border-b px-4 py-3 text-sm"
    >
      <span className="grow">
        <span className="font-medium">
          {t('dataResidency.orgEmbedding.banner.title')}
        </span>
        {' — '}
        {t('dataResidency.orgEmbedding.banner.body')}
      </span>
      <Link
        to="/dashboard/$id/settings/data-residency"
        params={{ id: organizationId }}
        className="underline underline-offset-2"
      >
        {t('dataResidency.orgEmbedding.banner.link')}
      </Link>
    </Row>
  );
}
