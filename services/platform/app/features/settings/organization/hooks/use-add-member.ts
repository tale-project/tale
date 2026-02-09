import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

// Note: Optimistic updates not added for create operations - complex type matching
export function useAddMember() {
  return useMutation(api.members.mutations.addMember);
}
