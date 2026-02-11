import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useUpdatePassword() {
  return useConvexMutation(api.users.mutations.updateUserPassword);
}
