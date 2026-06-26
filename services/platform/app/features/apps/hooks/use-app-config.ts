import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

/**
 * An installed app's per-install config values (`requires.config` keys → values,
 * e.g. github owner/repo). Reactive; `{}` until configured. Read by the app
 * runtime so views resolve `$config:<key>`; edited via the app's config form.
 */
export function useAppConfig(
  organizationId: string,
  appSlug: string,
): { config: Record<string, unknown>; isLoading: boolean } {
  const q = useConvexQuery(api.apps.config.getAppConfig, {
    organizationId,
    appSlug,
  });
  const data: Record<string, unknown> = q.data ?? {};
  return { config: data, isLoading: q.isLoading };
}

/** Mutation to set an installed app's per-install config. */
export function useSetAppConfig() {
  return useConvexMutation(api.apps.config.setAppConfig);
}
