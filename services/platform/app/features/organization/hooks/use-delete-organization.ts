'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';

import { useUserOrganizationsWithDetails } from '@/app/features/organization/hooks/queries';
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { useToast } from '@/app/hooks/use-toast';
import { invalidateAuthState } from '@/app/lib/auth/session-query';
import { useT } from '@/lib/i18n/client';
import {
  backendErrorCode,
  backendErrorMessage,
} from '@/lib/utils/backend-error';

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
 * Encapsulates the full organization-deletion flow: the ONE server call
 * (the backend tears the organization down in a single transaction — a
 * refusal or failure leaves it exactly as it was), success/failure toasts,
 * and the post-delete navigation. Shared so any surface that deletes an org
 * (currently the organization settings page) behaves identically.
 */
export function useDeleteOrganization() {
  const { t: tSettings } = useT('settings');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { organizations: userOrgs } = useUserOrganizationsWithDetails();
  // This hook owns the failure feedback (the reason matters: a legal hold
  // is actionable), so the generic mutation toast is opted out.
  const deleteOrganizationMutation = useBackendMutation(
    'organizations/delete:deleteOrganization',
    { errorToast: false },
  );

  const [isDeleting, setIsDeleting] = useState(false);

  const deleteOrganization = useCallback(
    async ({ organizationId, isCurrent }: DeleteOrganizationArgs) => {
      setIsDeleting(true);
      try {
        await deleteOrganizationMutation.mutateAsync({ organizationId });

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
        // The server refused under an active legal hold: the org is intact
        // and the way forward is releasing the hold — say so, in the
        // reader's language, instead of echoing the wire text.
        const description =
          backendErrorCode(err) === 'LEGAL_HOLD_ACTIVE'
            ? tSettings('organization.deleteBlockedByLegalHold')
            : backendErrorMessage(err, err instanceof Error ? err.message : '');
        toast({
          title: tSettings('organization.deleteFailed'),
          ...(description !== '' ? { description } : {}),
          variant: 'destructive',
        });
        return false;
      } finally {
        setIsDeleting(false);
      }
    },
    [
      deleteOrganizationMutation,
      toast,
      userOrgs,
      queryClient,
      navigate,
      tSettings,
    ],
  );

  return { deleteOrganization, isDeleting };
}
