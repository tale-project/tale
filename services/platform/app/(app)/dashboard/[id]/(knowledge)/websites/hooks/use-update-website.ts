import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Optimistic updates not added because getWebsites uses complex pagination params
export function useUpdateWebsite() {
  return useMutation(api.websites.updateWebsite);
}
