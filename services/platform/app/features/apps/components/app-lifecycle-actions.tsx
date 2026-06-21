'use client';

/** App lifecycle actions (⋯ menu) for an installed app: Reinstall and Uninstall.
 *
 * Reinstall re-syncs the app's files from the latest template and KEEPS the org's
 * per-agent env vars & secrets (a non-destructive confirm). Uninstall is the
 * destructive teardown — it removes the app's agents, workflows, pages, and those
 * env vars & secrets (a delete confirm). Both reuse the shared
 * `useAppInstallActions` install/uninstall actions. Used on the Apps grid card and
 * the app detail page so the lifecycle is discoverable from either place. */
import { RotateCw, Trash2 } from 'lucide-react';
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
   * The app's bound project, for a project-scoped install — reused on reinstall
   * so the binding is preserved (reinstalling without it would fail validation).
   * Undefined for org-scoped apps.
   */
  projectId?: string;
  /** Extra classes for the ⋯ trigger (e.g. card overlay positioning). */
  triggerClassName?: string;
  onReinstalled?: () => void;
  onUninstalled?: () => void;
}

export function AppLifecycleActions({
  appSlug,
  appName,
  organizationId,
  projectId,
  triggerClassName,
  onReinstalled,
  onUninstalled,
}: AppLifecycleActionsProps) {
  const { t } = useT('apps');
  const { install, uninstall } = useAppInstallActions(organizationId);
  const dialogs = useEntityRowDialogs(['reinstall', 'uninstall']);
  const [busy, setBusy] = useState(false);

  const handleReinstall = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await install(appSlug, projectId);
      toast({ title: t('install.reinstalled'), variant: 'success' });
      dialogs.setOpen.reinstall(false);
      onReinstalled?.();
    } catch (error) {
      console.error(error);
      toast({ title: t('install.reinstallFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }, [busy, install, appSlug, projectId, t, dialogs, onReinstalled]);

  const handleUninstall = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await uninstall(appSlug);
      toast({ title: t('install.uninstalled') });
      dialogs.setOpen.uninstall(false);
      onUninstalled?.();
    } catch (error) {
      console.error(error);
      toast({ title: t('install.uninstallFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }, [busy, uninstall, appSlug, t, dialogs, onUninstalled]);

  const actions = [
    {
      key: 'reinstall',
      label: t('install.reinstall'),
      icon: RotateCw,
      onClick: () => dialogs.open.reinstall(),
    },
    {
      key: 'uninstall',
      label: t('install.uninstall'),
      icon: Trash2,
      destructive: true,
      onClick: () => dialogs.open.uninstall(),
    },
  ];

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
