import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: No list to update - password change doesn't affect any query
export function useUpdatePassword() {
  return useMutation(api.users.mutations.updateUserPassword);
}
