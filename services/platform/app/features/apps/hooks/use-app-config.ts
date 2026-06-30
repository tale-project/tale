import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

/**
 * An installed app's per-install config values (`requires.config` keys → values,
 * e.g. github owner/repo). Reactive; `{}` until configured. Read by the app
 * runtime so views resolve `$config:<key>`; edited via the app's config form.
 *
 * Pass `projectId` for a `scope: 'project'` app to read THAT project's config
 * (each bound project owns its own values); omit it for org-scoped apps.
 */
export function useAppConfig(
  organizationId: string,
  appSlug: string,
  projectId?: string,
): { config: Record<string, unknown>; isLoading: boolean } {
  const q = useConvexQuery(api.apps.config.getAppConfig, {
    organizationId,
    appSlug,
    ...(projectId !== undefined && { projectId: asProjectId(projectId) }),
  });
  const data: Record<string, unknown> = q.data ?? {};
  return { config: data, isLoading: q.isLoading };
}

/** Mutation to set an installed app's per-install config. */
export function useSetAppConfig() {
  return useConvexMutation(api.apps.config.setAppConfig);
}
