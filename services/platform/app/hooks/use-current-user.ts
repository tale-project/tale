import { useQuery } from '@tanstack/react-query';

import { currentUserQuery } from '@/app/lib/backend/account';

export function useCurrentUser() {
  return useQuery(currentUserQuery());
}
