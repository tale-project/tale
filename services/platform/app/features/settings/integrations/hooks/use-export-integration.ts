import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

/**
 * Export an installed integration's on-disk files (config.json + optional
 * connector.ts + icon.svg) as a downloadable zip, returned base64-encoded.
 */
export function useExportIntegration() {
  return useConvexAction(api.integrations.file_actions.exportIntegration);
}
