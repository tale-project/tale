import { useAction } from 'convex/react';
import { useCallback, useState } from 'react';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useInstallIntegration() {
  const installFn = useAction(api.integrations.file_actions.installIntegration);
  const [isPending, setIsPending] = useState(false);

  const install = useCallback(
    async (args: { orgSlug: string; slug: string; organizationId: string }) => {
      setIsPending(true);
      try {
        const result = await installFn(args);
        window.dispatchEvent(new Event('integration-updated'));
        return result;
      } finally {
        setIsPending(false);
      }
    },
    [installFn],
  );

  return { install, isPending };
}

export function useTestIntegration() {
  return useConvexAction(api.integrations.actions.testConnection);
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
