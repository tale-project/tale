'use client';

import { useMemo } from 'react';

import { useIntegrations } from '@/app/features/settings/integrations/hooks/queries';
import type { Integration } from '@/app/features/settings/integrations/hooks/use-integration-manage';
import { mergeIntegrationListItem } from '@/app/features/settings/integrations/lib/merge-integration';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export interface RequiredIntegration {
  slug: string;
  /** The merged file-definition + credential object the connect form consumes. */
  integration: Integration;
  /** A credential row exists and is active. */
  connected: boolean;
  /** The integration definition is present in the org (scaffolded/installed). */
  exists: boolean;
}

type CredentialRow = Record<string, unknown> & {
  slug: string;
  _id?: string;
  isActive?: boolean;
  status?: string;
};

function isFileItem(
  item: unknown,
): item is Record<string, unknown> & { slug: unknown } {
  return (
    item != null &&
    typeof item === 'object' &&
    'slug' in item &&
    'title' in item
  );
}

/**
 * For an app's declared `requires.integrations`, resolve each slug to the merged
 * Integration object the connect form needs (file definition + reactive
 * credential status). `connected` drops a slug from `blockedSlugs` the moment its
 * credential goes active — both queries are reactive, so the wizard advances and
 * the readiness checklist clears without a manual refetch.
 */
export function useRequiredIntegrations(
  organizationId: string,
  slugs: readonly string[],
): {
  required: RequiredIntegration[];
  blockedSlugs: string[];
  isLoading: boolean;
} {
  const { integrations: fileIntegrations, isLoading: filesLoading } =
    useIntegrations(organizationId);
  const credentialsQuery = useConvexQuery(
    api.integrations.credential_queries.list,
    { organizationId },
  );

  const required = useMemo<RequiredIntegration[]>(() => {
    const credList =
      (credentialsQuery.data as CredentialRow[] | undefined) ?? [];
    const credBySlug = new Map(credList.map((c) => [c.slug, c]));
    const fileBySlug = new Map(
      (fileIntegrations as unknown[]).filter(isFileItem).map((item) => {
        return [String(item.slug), item] as const;
      }),
    );

    return slugs.map((slug) => {
      const fileItem = fileBySlug.get(slug);
      const cred = credBySlug.get(slug);
      const exists = fileItem !== undefined;
      const connected =
        cred != null && cred.isActive === true && cred.status === 'active';
      const merged = exists
        ? mergeIntegrationListItem(fileItem, cred, organizationId)
        : // Definition missing from the org (a newer builtin not yet scaffolded):
          // a minimal stub so the step renders a graceful "unavailable" state.
          { _id: slug, slug, name: slug, title: slug, organizationId };
      return {
        slug,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- merged shape satisfies the manage hook's Integration
        integration: merged as unknown as Integration,
        connected,
        exists,
      };
    });
  }, [credentialsQuery.data, fileIntegrations, slugs, organizationId]);

  const blockedSlugs = useMemo(
    () => required.filter((r) => !r.connected).map((r) => r.slug),
    [required],
  );

  return {
    required,
    blockedSlugs,
    isLoading: filesLoading || credentialsQuery.isLoading,
  };
}
