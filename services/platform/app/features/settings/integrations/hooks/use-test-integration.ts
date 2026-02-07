import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: useAction returns test result - can't predict success/failure
export function useTestIntegration() {
  return useAction(api.integrations.actions.testConnection);
}
