import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useUpdateWebsite() {
  return useMutation(api.websites.mutations.updateWebsite);
}
