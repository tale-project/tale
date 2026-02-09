import { useAction } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useGenerateCron() {
  return useAction(api.workflows.triggers.actions.generateCronExpression);
}
