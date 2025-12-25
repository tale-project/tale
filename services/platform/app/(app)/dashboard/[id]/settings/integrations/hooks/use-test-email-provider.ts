import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: useAction returns test result - can't predict success/failure
export function useTestEmailProvider() {
  return useAction(api.email_providers.testExistingProvider);
}
