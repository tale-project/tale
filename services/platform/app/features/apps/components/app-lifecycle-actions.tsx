'use client';

/** App lifecycle actions (⋯ menu). Two distinct concepts, split by context:
 *
 *  - context 'project' (inside a bound project): "Remove from this project" —
 *    drops only this project's binding; never tears down the shared org
 *    resources, and never offers org-wide Uninstall here.
 *  - context 'org' (the Apps grid card + the org app page): "Reinstall"
 *    (re-sync files, keep env/secrets) and "Uninstall" (org-wide teardown).
 *    Uninstall is REFUSED server-side while any project still has the app
 *    (`APP_HAS_BOUND_PROJECTS`); we surface that as a clear toast, and when the
 *    bound-project count is known we block it up front with a hint. */
import { ConvexError } from 'convex/values';
import { FolderMinus, RotateCw, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useAppInstallActions } from '../hooks/use-install-state';

interface AppLifecycleActionsProps {
  appSlug: string;
  appName: string;
  organizationId: string;
  /**
   * 'project': rendered inside a bound project → only "Remove from this project".
   * 'org': rendered on org surfaces → "Reinstall" + "Uninstall".
   */
  context: 'org' | 'project';
  /** Required when context is 'project' — the project to remove the app from. */
  projectId?: string;
  /**
   * context 'org': how many projects still have the app bound. When > 0,
   * Uninstall is blocked up front with a hint (the server refuses it anyway).
   */
  boundProjectCount?: number;
  /** Extra classes for the ⋯ trigger (e.g. card overlay positioning). */
  triggerClassName?: string;
  onChanged?: () => void;
  /** When set, adds a "Configuration" item that opens the app's config panel.
   *  Omitted for apps that declare no `requires.config`. */
  onConfigure?: () => void;
}

export function AppLifecycleActions({
  appSlug,
  appName,
  organizationId,
  context,
  projectId,
  boundProjectCount,
  triggerClassName,
  onChanged,
  onConfigure,
}: AppLifecycleActionsProps) {
  const { t } = useT('apps');
  const { reinstall, uninstall, removeFromProject } =
    useAppInstallActions(organizationId);
  const dialogs = useEntityRowDialogs([
    'reinstall',
    'uninstall',
    'removeFromProject',
  ]);
  const [busy, setBusy] = useState(false);

  const handleReinstall = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await reinstall(appSlug);
      toast({ title: t('install.reinstalled'), variant: 'success' });
      dialogs.setOpen.reinstall(false);
      onChanged?.();
    } catch (error) {
      console.error(error);
      toast({ title: t('install.reinstallFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }, [busy, reinstall, appSlug, t, dialogs, onChanged]);

  const handleRemoveFromProject = useCallback(async () => {
    if (busy || !projectId) return;
    setBusy(true);
    try {
      await removeFromProject(appSlug, projectId);
      toast({ title: t('install.removedFromProject'), variant: 'success' });
      dialogs.setOpen.removeFromProject(false);
      onChanged?.();
    } catch (error) {
      console.error(error);
      toast({
        title: t('install.removeFromProjectFailed'),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }, [busy, removeFromProject, appSlug, projectId, t, dialogs, onChanged]);

  const handleUninstall = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await uninstall(appSlug);
      toast({ title: t('install.uninstalled') });
      dialogs.setOpen.uninstall(false);
      onChanged?.();
    } catch (error) {
      // The server refuses while the app is still bound to projects — surface
      // exactly which ones so the operator knows what to remove first.
      const data = error instanceof ConvexError ? error.data : undefined;
      if (
        data &&
        typeof data === 'object' &&
        'code' in data &&
        data.code === 'APP_HAS_BOUND_PROJECTS'
      ) {
        const projects = Array.isArray(data.projects)
          ? data.projects.join(', ')
          : '';
        toast({
          title: t('install.uninstallBlocked', { projects }),
          variant: 'destructive',
        });
      } else {
        console.error(error);
        toast({ title: t('install.uninstallFailed'), variant: 'destructive' });
      }
      dialogs.setOpen.uninstall(false);
    } finally {
      setBusy(false);
    }
  }, [busy, uninstall, appSlug, t, dialogs, onChanged]);

  const blockedByBindings = (boundProjectCount ?? 0) > 0;

  // "Configuration" leads the menu (when the app declares config); a separator
  // sets it apart from the lifecycle (reinstall/remove/uninstall) group below.
  const configAction = onConfigure
    ? [
        {
          key: 'configure',
          label: t('config.title'),
          icon: SlidersHorizontal,
          onClick: onConfigure,
        },
      ]
    : [];
  const lifecycleActions =
    context === 'project'
      ? [
          {
            key: 'removeFromProject',
            label: t('install.removeFromProject'),
            icon: FolderMinus,
            destructive: true,
            separator: configAction.length > 0,
            onClick: () => dialogs.open.removeFromProject(),
          },
        ]
      : [
          {
            key: 'reinstall',
            label: t('install.reinstall'),
            icon: RotateCw,
            separator: configAction.length > 0,
            onClick: () => dialogs.open.reinstall(),
          },
          {
            key: 'uninstall',
            label: t('install.uninstall'),
            icon: Trash2,
            destructive: true,
            onClick: () => {
              if (blockedByBindings) {
                toast({
                  title: t('install.uninstallBlockedCount', {
                    count: boundProjectCount ?? 0,
                  }),
                  variant: 'destructive',
                });
                return;
              }
              dialogs.open.uninstall();
            },
          },
        ];
  const actions = [...configAction, ...lifecycleActions];

  return (
    <>
      <EntityRowActions
        actions={actions}
        ariaLabel={t('install.menuLabel', { name: appName })}
        triggerClassName={triggerClassName}
        disabled={busy}
      />

      <ConfirmDialog
        open={dialogs.isOpen.reinstall}
        onOpenChange={dialogs.setOpen.reinstall}
        title={t('install.reinstallTitle')}
        description={t('install.reinstallDescription')}
        confirmText={t('install.reinstall')}
        isLoading={busy}
        onConfirm={() => void handleReinstall()}
      />

      <ConfirmDialog
        open={dialogs.isOpen.removeFromProject}
        onOpenChange={dialogs.setOpen.removeFromProject}
        title={t('install.removeFromProjectTitle')}
        description={t('install.removeFromProjectDescription', {
          name: appName,
        })}
        confirmText={t('install.removeFromProject')}
        isLoading={busy}
        onConfirm={() => void handleRemoveFromProject()}
      />

      <DeleteDialog
        open={dialogs.isOpen.uninstall}
        onOpenChange={dialogs.setOpen.uninstall}
        title={t('install.uninstallTitle')}
        description={t('install.uninstallDescription')}
        preview={{ primary: appName }}
        warning={t('install.uninstallWarning')}
        deleteText={t('install.uninstall')}
        isDeleting={busy}
        onDelete={() => void handleUninstall()}
      />
    </>
  );
}
