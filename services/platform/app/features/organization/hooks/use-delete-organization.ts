'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';

import { useUserOrganizationsWithDetails } from '@/app/features/organization/hooks/queries';
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { useToast } from '@/app/hooks/use-toast';
import { invalidateAuthState } from '@/app/lib/auth/session-query';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';

interface DeleteOrganizationArgs {
  organizationId: string;
  /**
   * Whether the org being deleted is the one the user is currently viewing.
   * When true, the user is routed to another org (or org creation) after the
   * delete so they don't sit on a dead organization context.
   */
  isCurrent: boolean;
}

/**
 * Encapsulates the full organization-deletion flow: the Convex cleanup
 * preparation, the Better Auth delete call, success/failure toasts, and the
 * post-delete navigation. Shared so any surface that deletes an org (currently
 * the organization settings page) behaves identically.
 */
export function useDeleteOrganization() {
  const { t: tSettings } = useT('settings');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { organizations: userOrgs } = useUserOrganizationsWithDetails();
  const prepareOrganizationDeletion = useBackendMutation(
    'organizations/delete_cleanup:prepareOrganizationDeletion',
  );

  const [isDeleting, setIsDeleting] = useState(false);

  const deleteOrganization = useCallback(
    async ({ organizationId, isCurrent }: DeleteOrganizationArgs) => {
      setIsDeleting(true);
      try {
        await prepareOrganizationDeletion.mutateAsync({ organizationId });

        const result = await authClient.organization.delete({
          organizationId,
        });
        if (result?.error) {
          throw new Error(result.error.message ?? 'Delete failed');
        }

        toast({
          title: tSettings('organization.deleteSuccess'),
          variant: 'success',
        });

        if (isCurrent) {
          const next = (userOrgs ?? []).find(
            (o) => o.organizationId !== organizationId,
          )?.organizationId;
          if (next) {
            void navigate({
              to: '/dashboard/switching',
              search: { to: next },
              replace: true,
            });
          } else {
            await invalidateAuthState(queryClient);
            void navigate({
              to: '/dashboard/create-organization',
              replace: true,
            });
          }
        }
        return true;
      } catch (err) {
        console.error('Failed to delete organization:', err);
        toast({
          title: tSettings('organization.deleteFailed'),
          description: err instanceof Error ? err.message : undefined,
          variant: 'destructive',
        });
        return false;
      } finally {
        setIsDeleting(false);
      }
    },
    [
      prepareOrganizationDeletion,
      toast,
      userOrgs,
      queryClient,
      navigate,
      tSettings,
    ],
  );

  return { deleteOrganization, isDeleting };
}
