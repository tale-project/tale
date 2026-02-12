import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useRescanWebsite() {
  return useConvexAction(api.websites.actions.rescanWebsite);
}
