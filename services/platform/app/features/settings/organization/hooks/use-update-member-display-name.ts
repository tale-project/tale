import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useUpdateMemberDisplayName() {
  return useMutation(api.members.mutations.updateMemberDisplayName);
}
