'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useMutation } from 'convex/react';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { useUserOrganizationsWithDetails } from '@/app/features/organization/hooks/queries';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface OrganizationListPanelProps {
  currentOrganizationId: string | null;
  onAfterAction?: () => void;
}

export function OrganizationListPanel({
  currentOrganizationId,
  onAfterAction,
}: OrganizationListPanelProps) {
  const { t: tSettings } = useT('settings');
  const { t: tNav } = useT('navigation');
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { organizations: userOrgs } = useUserOrganizationsWithDetails();
  const prepareOrganizationDeletion = useMutation(
    api.organizations.delete_cleanup.prepareOrganizationDeletion,
  );

  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    organizationId: string;
    name: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const switchToOrg = useCallback(
    (nextOrgId: string) => {
      if (nextOrgId === currentOrganizationId) {
        onAfterAction?.();
        return;
      }
      setSwitchingOrgId(nextOrgId);
      const subpath =
        location.href.match(/^\/dashboard\/[^/]+\/(.*)$/)?.[1] ?? '';
      void navigate({
        to: '/dashboard/switching',
        search: { to: nextOrgId, subpath: subpath || undefined },
        replace: true,
      });
      onAfterAction?.();
    },
    [currentOrganizationId, navigate, location.href, onAfterAction],
  );

  const deleteOrganization = useCallback(async () => {
    if (!deleteTarget) return;
    const { organizationId: targetId } = deleteTarget;
    const isDeletingCurrent = targetId === currentOrganizationId;
    setIsDeleting(true);
    try {
      await prepareOrganizationDeletion({ organizationId: targetId });

      const result = await authClient.organization.delete({
        organizationId: targetId,
      });
      if (result?.error) {
        throw new Error(result.error.message ?? 'Delete failed');
      }

      toast({
        title: tSettings('organization.deleteSuccess'),
        variant: 'success',
      });

      setDeleteTarget(null);

      if (isDeletingCurrent) {
        const next = (userOrgs ?? []).find(
          (o) => o.organizationId !== targetId,
        )?.organizationId;
        if (next) {
          void navigate({
            to: '/dashboard/switching',
            search: { to: next },
            replace: true,
          });
        } else {
          await queryClient.invalidateQueries({
            queryKey: ['auth', 'session'],
          });
          void navigate({
            to: '/dashboard/create-organization',
            replace: true,
          });
        }
      }
    } catch (err) {
      console.error('Failed to delete organization:', err);
      toast({
        title: tSettings('organization.deleteFailed'),
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  }, [
    deleteTarget,
    currentOrganizationId,
    prepareOrganizationDeletion,
    toast,
    userOrgs,
    queryClient,
    navigate,
    tSettings,
  ]);

  const orgs = userOrgs ?? [];

  return (
    <div className="flex flex-col">
      <div className="text-muted-foreground px-3 pt-2 pb-1.5 text-xs font-medium tracking-wide uppercase">
        {tNav('orgSwitcher.label')}
      </div>

      <ul className="max-h-72 overflow-y-auto py-1">
        {orgs.map((org) => {
          const isCurrent = org.organizationId === currentOrganizationId;
          const canDelete = org.role === 'owner' && org.slug !== 'default';
          const isSwitching = switchingOrgId === org.organizationId;
          return (
            <li key={org.organizationId} className="group/org relative">
              <button
                type="button"
                onClick={() => switchToOrg(org.organizationId)}
                disabled={isSwitching}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  isCurrent
                    ? 'bg-muted'
                    : 'hover:bg-muted focus-visible:bg-muted',
                  isSwitching && 'opacity-60',
                )}
              >
                <span
                  className="bg-muted-foreground/15 text-foreground flex size-7 shrink-0 items-center justify-center rounded text-xs font-semibold"
                  aria-hidden="true"
                >
                  {org.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">
                    {org.name}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {org.slug ? `@${org.slug} · ` : ''}
                    {org.role}
                  </span>
                </span>
                {isSwitching ? (
                  <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
                ) : isCurrent ? (
                  <Check className="text-foreground size-4 shrink-0" />
                ) : (
                  // Reserve space so the trash icon doesn't shift other rows.
                  <span className="size-4 shrink-0" aria-hidden="true" />
                )}
              </button>
              {canDelete && (
                <button
                  type="button"
                  aria-label={tSettings('organization.deleteAriaLabel', {
                    name: org.name,
                  })}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget({
                      organizationId: org.organizationId,
                      name: org.name,
                    });
                  }}
                  className={cn(
                    'absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 transition-opacity',
                    'text-muted-foreground hover:text-destructive hover:bg-destructive/10',
                    'opacity-0 group-hover/org:opacity-100 focus-visible:opacity-100',
                  )}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="border-border border-t p-1">
        <button
          type="button"
          onClick={() => {
            void navigate({ to: '/dashboard/create-organization' });
            onAfterAction?.();
          }}
          className="hover:bg-muted focus-visible:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
        >
          <Plus className="text-muted-foreground size-4 shrink-0" />
          <span>{tSettings('organization.createOrganization')}</span>
        </button>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteTarget(null);
        }}
        title={tSettings('organization.deleteDialogTitle')}
        description={
          deleteTarget
            ? tSettings('organization.deleteDialogDescription', {
                name: deleteTarget.name,
              })
            : ''
        }
        variant="destructive"
        confirmText={tSettings('organization.deleteConfirmAction')}
        loadingText={tSettings('organization.deleteLoading')}
        isLoading={isDeleting}
        onConfirm={() => void deleteOrganization()}
      />
    </div>
  );
}
