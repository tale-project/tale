import { queryOptions } from '@tanstack/react-query';

import { useReactQuery } from '@/app/hooks/use-react-query';
import { retryAdaptedRead, runAdapted } from '@/app/lib/backend/adapters';
import { backendFetch } from '@/app/lib/backend/api-client';
import type { GithubAppRepositories } from '@/app/lib/backend/contract/connector-credentials';
import { backendKey } from '@/app/lib/backend/query-keys';
import { CONNECTOR_CREDENTIAL_HINT_ENTITY } from '@/lib/shared/hint-entities';

/**
 * The repositories a `github-app` credential's installation reaches, as
 * GitHub lists them now — the server reads them with the installation token
 * the connector's calls use, so the list is exactly what a call can reach.
 * Keyed under the connector-credential entity: a change to the credential
 * (its installation recorded again after the repositories changed on
 * GitHub) refreshes an open list. A live GitHub read, so only the open
 * repositories dialog asks for it, never the table. Read as every adapted
 * read is: a refusal arrives with its code, which the connectors' error
 * mapping words, and is never retried.
 */
function githubAppRepositoriesQuery(
  organizationId: string,
  credentialId: string,
) {
  return queryOptions({
    queryKey: backendKey(
      organizationId,
      CONNECTOR_CREDENTIAL_HINT_ENTITY,
      'github-app-repositories',
      credentialId,
    ),
    queryFn: ({ signal }) =>
      runAdapted(() =>
        backendFetch<GithubAppRepositories>(
          `/connector-credentials/${encodeURIComponent(credentialId)}/github-app/repositories`,
          { orgId: organizationId, signal },
        ),
      ),
    retry: retryAdaptedRead,
  });
}

export function useGithubAppRepositories(
  organizationId: string,
  credentialId: string,
) {
  return useReactQuery(
    githubAppRepositoriesQuery(organizationId, credentialId),
  );
}
