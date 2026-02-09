import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useSetMemberPassword() {
  return useMutation(api.users.mutations.setMemberPassword);
}
