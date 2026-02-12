import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

// Note: useAction returns generated URL - can't predict result
export function useGenerateOAuthUrl() {
  return useConvexAction(api.email_providers.actions.generateOAuth2AuthUrl);
}

// Note: useAction returns test result - can't predict success/failure
export function useTestEmailProvider() {
  return useConvexAction(api.email_providers.actions.testExistingProvider);
}

// Note: useAction returns test result - can't predict success/failure
export function useTestEmailConnection() {
  return useConvexAction(api.email_providers.actions.testConnection);
}

// Note: useAction returns test result - can't predict success/failure
export function useTestIntegration() {
  return useConvexAction(api.integrations.actions.testConnection);
}

export function useTestSsoConfig() {
  return useConvexAction(api.sso_providers.actions.testConfig);
}

export function useTestExistingSsoConfig() {
  return useConvexAction(api.sso_providers.actions.testExistingConfig);
}

export function useSetDefaultProvider() {
  return useConvexAction(api.email_providers.actions.setDefault);
}

export function useCreateEmailProvider() {
  return useConvexAction(api.email_providers.actions.create);
}

export function useCreateIntegration() {
  return useConvexAction(api.integrations.actions.create);
}

export function useUpdateIntegration() {
  return useConvexAction(api.integrations.actions.update);
}

export function useCreateOAuth2Provider() {
  return useConvexAction(api.email_providers.actions.createOAuth2Provider);
}

export function useUpdateOAuth2Provider() {
  return useConvexAction(api.email_providers.actions.updateOAuth2Provider);
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

export function useSsoCredentials() {
  return useConvexAction(api.sso_providers.actions.getSsoCredentialsForEmail);
}

export function useGenerateUploadUrl() {
  return useConvexAction(api.files.actions.generateUploadUrl);
}

export function useUpdateIntegrationIcon() {
  return useConvexAction(api.integrations.actions.updateIcon);
}

export function useGenerateIntegrationOAuth2Url() {
  return useConvexAction(api.integrations.actions.generateOAuth2Url);
}

export function useSaveOAuth2Credentials() {
  return useConvexAction(api.integrations.actions.saveOAuth2ClientCredentials);
}

export function useDeleteIntegrationAction() {
  return useConvexAction(api.integrations.actions.deleteIntegrationAction);
}
