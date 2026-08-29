/**
 * Org-switching staging page.
 *
 * Switchers (user-button dropdown, Settings → Your organizations) navigate
 * here with `?to={targetOrgId}` instead of doing the switch inline. Doing
 * the work on its own route eliminates races between: the old dashboard
 * route unmounting, TanStack session cache invalidation, and the new
 * dashboard route's active-org-vs-route guard re-triggering setActive.
 *
 * While we're here a centered spinner is shown. We don't leave until
 * `session.activeOrganizationId` actually reflects the target — so the
 * downstream /dashboard/$id route mounts in a coherent state and does
 * not re-flash a loading indicator of its own.
 */

import { FullPageCenter } from '@tale/ui/full-page-center';
import { VStack } from '@tale/ui/layout';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { useQueryClient } from '@tanstack/react-query';
import {
  createFileRoute,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import { useEffect, useMemo, useRef } from 'react';
import { z } from 'zod';

import { useUserOrganizationsWithDetails } from '@/app/features/organization/hooks/queries';
import { recordOrgSwitch } from '@/app/lib/backend/org';
import { resetCrossOrgDetailSubpath } from '@/app/lib/org-switch-subpath';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';

const searchSchema = z.object({
  to: z.string().min(1),
  // Everything after /dashboard/{id}/ — pathname + search + hash. E.g.
  // "settings/governance?group=security-monitoring" or "chat/abc#mid".
  // Preserves the page AND its query params so an org switch doesn't
  // lose tab selection / filters / hash anchors.
  subpath: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/switching')({
  validateSearch: searchSchema,
  component: SwitchingPage,
});

function SwitchingPage() {
  const { to: targetOrgId, subpath } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useT('settings');

  const { organizations } = useUserOrganizationsWithDetails();
  const ranRef = useRef(false);

  const targetName = useMemo(
    () =>
      (organizations ?? []).find((o) => o.organizationId === targetOrgId)?.name,
    [organizations, targetOrgId],
  );

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    void (async () => {
      try {
        await authClient.organization.setActive({
          organizationId: targetOrgId,
        });
        // Audit + lastActiveOrganizationId persistence is NOT on the critical
        // path — fire it in the background so the spinner doesn't wait on the
        // dedup scan + better-auth `updateMany` round-trip. Initiated before
        // navigate so the in-flight mutation survives this route unmounting.
        void recordOrgSwitch(targetOrgId).catch((err) => {
          console.warn('Failed to record org switch audit entry:', err);
        });
        // Force a fresh session read so downstream `useQuery(['auth','session'])`
        // observers see the new activeOrganizationId before we navigate.
        // `refetchQueries` already refetches active observers, so the prior
        // `invalidateQueries` was redundant.
        await queryClient.refetchQueries({ queryKey: ['auth', 'session'] });

        // Drop cached Convex queries scoped to the PREVIOUS org. The old
        // /dashboard/$id route has already unmounted (we're on /dashboard/
        // switching), so these have no observers — without this they linger
        // until gcTime (15min, router.tsx) keeping stale subscriptions alive
        // and risk briefly showing the previous org's data on the way in.
        // Convex keys are ['convexQuery', '<module>:<query>', args]; the
        // session query (['auth','session']) is left untouched, and queries
        // for the target org (or with no org arg) are kept.
        queryClient.removeQueries({
          predicate: (q) => {
            if (!Array.isArray(q.queryKey)) return false;
            // Backend keys are ['backend', <orgId>, entity, …]; drop the
            // previous org's rows (user-scoped 'me' rows are org-free).
            if (q.queryKey[0] === 'backend') {
              const scope = q.queryKey[1];
              return (
                typeof scope === 'string' &&
                scope !== 'me' &&
                scope !== targetOrgId
              );
            }
            if (q.queryKey[0] !== 'convexQuery') {
              return false;
            }
            const args = q.queryKey[2];
            if (
              typeof args !== 'object' ||
              args === null ||
              !('organizationId' in args)
            ) {
              return false;
            }
            const orgId = args.organizationId;
            return typeof orgId === 'string' && orgId !== targetOrgId;
          },
        });
      } catch (err) {
        console.error('Failed to switch organization:', err);
      }
      // Replace history entry so Back button doesn't return here. When a
      // subpath is provided, reconstruct the full URL so the user lands on
      // the same page in the new org. Using router.history.push lets us
      // push an arbitrary path string (the typed `navigate({ to })` API
      // would require enumerating every possible dashboard subroute).
      //
      // `resetCrossOrgDetailSubpath` strips an org-scoped entity id
      // (project/thread/workflow) from the carried subpath: that id doesn't
      // exist in the target org, so the by-id read would deny it and the user
      // would land on a "not found" dead-end. Reset to the section root; tab/
      // filter/config subpaths are preserved.
      if (subpath) {
        const targetSubpath = resetCrossOrgDetailSubpath(subpath);
        router.history.push(`/dashboard/${targetOrgId}/${targetSubpath}`, {
          replace: true,
        });
      } else {
        void navigate({
          to: '/dashboard/$id',
          params: { id: targetOrgId },
          replace: true,
        });
      }
    })();
  }, [targetOrgId, subpath, queryClient, navigate, router]);

  return (
    <FullPageCenter>
      <VStack gap={3} align="center">
        <Spinner size="lg" label={t('organization.switchingLabel')} />
        <Text variant="muted" className="text-sm">
          {targetName
            ? t('organization.switchingTo', { name: targetName })
            : t('organization.switching')}
        </Text>
      </VStack>
    </FullPageCenter>
  );
}
