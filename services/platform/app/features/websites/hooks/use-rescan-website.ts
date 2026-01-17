import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Triggers background job - status updates via realtime subscription
export function useRescanWebsite() {
  return useMutation(api.mutations.websites.rescanWebsite);
}
