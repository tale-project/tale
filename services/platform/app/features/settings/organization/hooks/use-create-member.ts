import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Create operation - complex type matching for optimistic insert
export function useCreateMember() {
  return useMutation(api.mutations.users.createMember);
}
