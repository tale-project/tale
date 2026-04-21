import { useQueryClient } from '@tanstack/react-query';
import { useAction } from 'convex/react';
import { useCallback, useState } from 'react';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useInstallIntegration() {
  const installFn = useAction(api.integrations.file_actions.installIntegration);
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);

  const install = useCallback(
    async (args: { orgSlug: string; slug: string; organizationId: string }) => {
      setIsPending(true);
      try {
        const result = await installFn(args);
        void queryClient.invalidateQueries({
          queryKey: ['config', 'integrations'],
        });
        return result;
      } finally {
        setIsPending(false);
      }
    },
    [installFn, queryClient],
  );

  return { install, isPending };
}

export function useTestIntegration() {
  const base = useConvexAction(api.integrations.actions.testConnection);
  const queryClient = useQueryClient();

  const mutateAsync: typeof base.mutateAsync = useCallback(
    async (...args) => {
      const result = await base.mutateAsync(...args);
      // A successful test flips the credential to isActive and self-heals
      // config.installed on disk, so the cached file-based integrations list
      // must be refetched to pick up the new `installed` value.
      void queryClient.invalidateQueries({
        queryKey: ['config', 'integrations'],
      });
      return result;
    },
    [base, queryClient],
  );

  return { ...base, mutateAsync };
}

export function useTestSsoConfig() {
  return useConvexAction(api.sso_providers.actions.testConfig);
}

export function useTestExistingSsoConfig() {
  return useConvexAction(api.sso_providers.actions.testExistingConfig);
}

export function useUpsertSsoProvider() {
  return useConvexAction(api.sso_providers.actions.upsert);
}

export function useRemoveSsoProvider() {
  return useConvexAction(api.sso_providers.actions.remove);
}

export function useSsoFullConfig() {
  return useConvexAction(api.sso_providers.actions.getWithClientId);
}

export function useGenerateIntegrationOAuth2Url() {
  return useConvexAction(api.integrations.actions.generateOAuth2Url);
}

export function useSaveOAuth2Credentials() {
  return useConvexAction(api.integrations.actions.saveOAuth2ClientCredentials);
}
