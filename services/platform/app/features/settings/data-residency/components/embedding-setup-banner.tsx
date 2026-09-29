'use client';

import { Link } from '@tanstack/react-router';

import { ShellAlert } from '@/app/components/layout/shell-alert';
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
 * A `ShellAlert`, as the two-factor banners are — same row, same warning
 * tint, same trailing link — so every dashboard-level nudge reads the same.
 */
export function EmbeddingSetupBanner({
  organizationId,
}: {
  organizationId: string;
}) {
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  // The gate sits OUTSIDE the component that reads: both reads are admin
  // doors (`/knowledge/embedding`, `/provider-credentials`), and mounting
  // them for a member fired two 403s on every dashboard page (2026-09-26
  // evaluation, E-05).
  if (abilityLoading || ability.cannot('read', 'orgSettings')) return null;
  return <EmbeddingSetupNudge organizationId={organizationId} />;
}

function EmbeddingSetupNudge({ organizationId }: { organizationId: string }) {
  const { t } = useT('settings');
  const embeddingQuery = useOrgKnowledgeEmbedding(organizationId);
  const credentialsQuery = useProviderCredentials(organizationId);

  // A failed or still-loading read is not evidence of a missing model. Saying
  // "knowledge search is off" on an unknown state is worse than saying nothing.
  if (embeddingQuery.data === undefined || embeddingQuery.isError) return null;
  if (embeddingQuery.data.configured) return null;
  if ((credentialsQuery.data ?? []).length === 0) return null;

  return (
    <ShellAlert>
      <span className="grow">
        <span className="font-medium">
          {t('dataResidency.orgEmbedding.banner.title')}
        </span>
        {/* On a phone, and on a viewport too short to spare the lines (a
            phone held sideways, a laptop at 200 %), the explanation is read
            out but not drawn: it wrapped the banner to three or four lines
            above every page, and the title plus the link already say what
            to do. */}
        <span className="short-viewport:sr-only sr-only sm:not-sr-only">
          {' — '}
          {t('dataResidency.orgEmbedding.banner.body')}
        </span>
      </span>
      <Link
        to="/dashboard/$id/settings/data-residency"
        params={{ id: organizationId }}
        className="underline underline-offset-2"
      >
        {t('dataResidency.orgEmbedding.banner.link')}
      </Link>
    </ShellAlert>
  );
}
