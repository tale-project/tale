'use client';

import { ErrorBoundaryBase } from '@tale/ui/error-boundaries/error-boundary-base';
import { lazy, Suspense } from 'react';

import { useProviderCredentials } from '@/app/features/settings/providers/hooks/queries';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';

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

/**
 * Whether the banner shows for a reader who can read the organization's
 * settings — `unknown` until both reads have answered. Its own hook so a
 * page with a nudge of its own (the Websites page) can stay silent where
 * this one already speaks. Both reads are admin doors: call it only behind
 * the `read orgSettings` gate.
 */
export function useEmbeddingSetupNudge(
  organizationId: string,
): 'shown' | 'hidden' | 'unknown' {
  const embeddingQuery = useOrgKnowledgeEmbedding(organizationId);
  const credentialsQuery = useProviderCredentials(organizationId);

  // A failed or still-loading read is not evidence of a missing model. Saying
  // "knowledge search is off" on an unknown state is worse than saying nothing.
  if (embeddingQuery.isError) return 'hidden';
  if (embeddingQuery.data === undefined) return 'unknown';
  if (embeddingQuery.data.configured) return 'hidden';
  if (credentialsQuery.data === undefined) {
    return credentialsQuery.isError ? 'hidden' : 'unknown';
  }
  return credentialsQuery.data.length > 0 ? 'shown' : 'hidden';
}

// The alert itself, with the settings words it quotes, loads only for an
// organization that needs it.
const EmbeddingSetupAlert = lazy(() =>
  import('./embedding-setup-alert').then((module) => ({
    default: module.EmbeddingSetupAlert,
  })),
);

function EmbeddingSetupNudge({ organizationId }: { organizationId: string }) {
  if (useEmbeddingSetupNudge(organizationId) !== 'shown') return null;
  return (
    <ErrorBoundaryBase fallback={() => null}>
      <Suspense fallback={null}>
        <EmbeddingSetupAlert organizationId={organizationId} />
      </Suspense>
    </ErrorBoundaryBase>
  );
}
