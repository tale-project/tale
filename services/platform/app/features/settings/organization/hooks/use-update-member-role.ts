import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useUpdateMemberRole() {
  return useMutation(api.members.mutations.updateMemberRole);
}
