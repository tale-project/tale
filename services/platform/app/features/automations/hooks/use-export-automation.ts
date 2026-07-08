import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

/**
 * Export an installed automation's on-disk bundle (its manifest plus views,
 * messages, scripts, and app-scoped agents) as a downloadable zip, returned
 * base64-encoded. Mirrors `useExportSkill` / `useExportIntegration`.
 */
export function useExportAutomation() {
  return useConvexAction(api.automations.file_actions.exportAutomation);
}
