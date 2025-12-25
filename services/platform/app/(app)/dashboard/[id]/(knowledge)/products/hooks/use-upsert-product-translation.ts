import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

/**
 * Hook for upserting a product translation.
 * No optimistic update as translations are typically displayed
 * separately from the main product list and require proper validation.
 */
export function useUpsertProductTranslation() {
  return useMutation(api.products.upsertProductTranslation);
}
