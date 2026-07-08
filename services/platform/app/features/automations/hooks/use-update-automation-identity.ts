import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

/**
 * Edit an installed automation's display identity (manifest `name` +
 * `description` — the automation's only user-facing strings). Mirrors
 * `useExportAutomation`; callers invalidate the automations list afterwards
 * so the breadcrumb/catalog pick the rename up.
 */
export function useUpdateAutomationIdentity() {
  return useConvexAction(api.automations.file_actions.updateAutomationIdentity);
}
