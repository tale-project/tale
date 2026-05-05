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

import { Spinner } from '@tale/ui/spinner';
import { useQueryClient } from '@tanstack/react-query';
import {
  createFileRoute,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import { useMutation } from 'convex/react';
import { useEffect, useMemo, useRef } from 'react';
import { z } from 'zod';

import { FullPageCenter } from '@/app/components/ui/layout/full-page-center';
import { VStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useUserOrganizationsWithDetails } from '@/app/features/organization/hooks/queries';
import { api } from '@/convex/_generated/api';
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
  const recordOrgSwitch = useMutation(
    api.organizations.record_org_switch.recordOrgSwitch,
  );
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
        // Force a fresh session read so downstream `useQuery(['auth','session'])`
        // observers see the new activeOrganizationId before we navigate.
        await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
        await queryClient.refetchQueries({ queryKey: ['auth', 'session'] });
        try {
          await recordOrgSwitch({ organizationId: targetOrgId });
        } catch (err) {
          console.warn('Failed to record org switch audit entry:', err);
        }
      } catch (err) {
        console.error('Failed to switch organization:', err);
      }
      // Replace history entry so Back button doesn't return here. When a
      // subpath is provided, reconstruct the full URL so the user lands on
      // the same page in the new org. Using router.history.push lets us
      // push an arbitrary path string (the typed `navigate({ to })` API
      // would require enumerating every possible dashboard subroute).
      if (subpath) {
        router.history.push(`/dashboard/${targetOrgId}/${subpath}`, {
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
  }, [targetOrgId, subpath, queryClient, recordOrgSwitch, navigate, router]);

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
