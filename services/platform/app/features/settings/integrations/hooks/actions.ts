import { useConvexActionMutation } from '@/app/hooks/use-convex-action-mutation';
import { api } from '@/convex/_generated/api';

export function useTestIntegration() {
  return useConvexActionMutation(api.integrations.actions.testConnection);
}

export function useTestSsoConfig() {
  return useConvexActionMutation(api.sso_providers.actions.testConfig);
}

export function useTestExistingSsoConfig() {
  return useConvexActionMutation(api.sso_providers.actions.testExistingConfig);
}

export function useCreateIntegration() {
  return useConvexActionMutation(api.integrations.actions.create);
}

export function useUpdateIntegration() {
  return useConvexActionMutation(api.integrations.actions.update);
}

export function useUpsertSsoProvider() {
  return useConvexActionMutation(api.sso_providers.actions.upsert);
}

export function useRemoveSsoProvider() {
  return useConvexActionMutation(api.sso_providers.actions.remove);
}

export function useSsoFullConfig() {
  return useConvexActionMutation(api.sso_providers.actions.getWithClientId);
}

export function useGenerateIntegrationOAuth2Url() {
  return useConvexActionMutation(api.integrations.actions.generateOAuth2Url);
}

export function useSaveOAuth2Credentials() {
  return useConvexActionMutation(
    api.integrations.actions.saveOAuth2ClientCredentials,
  );
}
