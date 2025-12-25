import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Create operation - paginated list makes optimistic insert complex
export function useCreateWebsite() {
  return useMutation(api.websites.createWebsite);
}
