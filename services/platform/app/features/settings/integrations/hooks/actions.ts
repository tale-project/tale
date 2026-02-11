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
