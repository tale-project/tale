import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useRemoveMember() {
  return useMutation(api.members.mutations.removeMember);
}
