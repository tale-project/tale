import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useDeleteWebsite() {
  return useMutation(api.websites.mutations.deleteWebsite);
}
