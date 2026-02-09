import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useSetDefaultProvider() {
  return useMutation(api.email_providers.mutations.setDefault);
}
