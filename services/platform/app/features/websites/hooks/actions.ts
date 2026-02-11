import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useRescanWebsite() {
  return useConvexMutation(api.websites.mutations.rescanWebsite);
}
