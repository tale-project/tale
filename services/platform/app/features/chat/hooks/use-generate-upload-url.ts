import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Utility - returns URL, doesn't affect any query
export function useGenerateUploadUrl() {
  return useMutation(api.mutations.file.generateUploadUrl);
}
