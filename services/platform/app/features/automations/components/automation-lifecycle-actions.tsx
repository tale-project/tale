'use client';

/** Automation lifecycle actions (⋯ menu). Two distinct concepts, split by context:
 *
 *  - context 'project' (inside a bound project): "Remove from this project" —
 *    drops only this project's binding; never tears down the shared org
 *    resources, and never offers org-wide Uninstall here.
 *  - context 'org' (the Automations grid card + the org automation page): "Reinstall"
 *    (re-sync files, keep env/secrets) and "Uninstall" (org-wide teardown).
 *    Uninstall is REFUSED server-side while any project still has the automation
 *    (`AUTOMATION_HAS_BOUND_PROJECTS`); we surface that as a clear toast, and when the
 *    bound-project count is known we block it up front with a hint. */
import { ConvexError } from 'convex/values';
import {
  Download,
  FolderMinus,
  PackageMinus,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { useCallback, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { downloadBase64File } from '@/lib/utils/download';

import { useExportAutomation } from '../hooks/use-export-automation';
import { useAutomationInstallActions } from '../hooks/use-install-state';
import { useReinstallWithPreflight } from '../hooks/use-reinstall-with-preflight';

interface AutomationLifecycleActionsProps {
  automationSlug: string;
  automationName: string;
  organizationId: string;
  /**
   * 'project': rendered inside a bound project → only "Remove from this project".
   * 'org': rendered on org surfaces → "Reinstall" + "Uninstall".
   */
  context: 'org' | 'project';
  /** Required when context is 'project' — the project to remove the automation from. */
  projectId?: string;
  /**
   * context 'org': how many projects still have the automation bound. When > 0,
   * Uninstall is blocked up front with a hint (the server refuses it anyway).
   */
  boundProjectCount?: number;
  /**
   * Set when this automation is a BUNDLE MEMBER (context 'org'): adds an
   * "Uninstall bundle" action that tears down the whole bundle — every
   * member's project bindings, then every member.
   */
  bundle?: { slug: string; name: string; memberCount: number };
  /** Extra classes for the ⋯ trigger (e.g. card overlay positioning). */
  triggerClassName?: string;
  onChanged?: () => void;
}

export function AutomationLifecycleActions({
  automationSlug,
  automationName,
  organizationId,
  context,
  projectId,
  boundProjectCount,
  bundle,
  triggerClassName,
  onChanged,
}: AutomationLifecycleActionsProps) {
  const { t } = useT('automations');
  const { uninstall, uninstallBundle, removeFromProject } =
    useAutomationInstallActions(organizationId);
  // Reinstall runs through the shared preflight flow: preview → override-list
  // confirm dialog → reinstall with the confirmed overrides.
  const {
    requestReinstall,
    dialog: reinstallDialog,
    isPending: reinstallPending,
  } = useReinstallWithPreflight(organizationId, onChanged);
  const dialogs = useEntityRowDialogs([
    'uninstall',
    'removeFromProject',
    'uninstallBundle',
  ]);
  const [busy, setBusy] = useState(false);
  const { mutateAsync: exportAutomation } = useExportAutomation();
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await exportAutomation({
        organizationId,
        slug: automationSlug,
      });
      downloadBase64File(result.filename, result.dataBase64, 'application/zip');
    } catch (error) {
      console.error(error);
      toast({ title: t('install.exportFailed'), variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }, [exporting, exportAutomation, organizationId, automationSlug, t]);

  const handleRemoveFromProject = useCallback(async () => {
    if (busy || !projectId) return;
    setBusy(true);
    try {
      await removeFromProject(automationSlug, projectId);
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
  }, [
    busy,
    removeFromProject,
    automationSlug,
    projectId,
    t,
    dialogs,
    onChanged,
  ]);

  const handleUninstall = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await uninstall(automationSlug);
      toast({ title: t('install.uninstalled'), variant: 'success' });
      dialogs.setOpen.uninstall(false);
      onChanged?.();
    } catch (error) {
      // The server refuses while the automation is still bound to projects — surface
      // exactly which ones so the operator knows what to remove first.
      const data = error instanceof ConvexError ? error.data : undefined;
      if (
        data &&
        typeof data === 'object' &&
        'code' in data &&
        data.code === 'AUTOMATION_HAS_BOUND_PROJECTS'
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
  }, [busy, uninstall, automationSlug, t, dialogs, onChanged]);

  const handleUninstallBundle = useCallback(async () => {
    if (busy || !bundle) return;
    setBusy(true);
    try {
      await uninstallBundle(bundle.slug);
      toast({ title: t('install.bundleUninstalled'), variant: 'success' });
      dialogs.setOpen.uninstallBundle(false);
      onChanged?.();
    } catch (error) {
      console.error(error);
      toast({
        title: t('install.bundleUninstallFailed'),
        variant: 'destructive',
      });
      dialogs.setOpen.uninstallBundle(false);
    } finally {
      setBusy(false);
    }
  }, [busy, uninstallBundle, bundle, t, dialogs, onChanged]);

  const blockedByBindings = (boundProjectCount ?? 0) > 0;

  const exportAction = {
    key: 'export',
    label: t('install.export'),
    icon: Download,
    onClick: () => void handleExport(),
  };

  const actions =
    context === 'project'
      ? [
          exportAction,
          {
            key: 'removeFromProject',
            label: t('install.removeFromProject'),
            icon: FolderMinus,
            destructive: true,
            onClick: () => dialogs.open.removeFromProject(),
          },
        ]
      : [
          {
            key: 'reinstall',
            label: t('install.reinstall'),
            icon: RotateCw,
            onClick: () => void requestReinstall(automationSlug),
          },
          exportAction,
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
          ...(bundle
            ? [
                {
                  key: 'uninstallBundle',
                  label: t('install.uninstallBundle'),
                  icon: PackageMinus,
                  destructive: true,
                  onClick: () => dialogs.open.uninstallBundle(),
                },
              ]
            : []),
        ];

  return (
    <>
      <EntityRowActions
        actions={actions}
        ariaLabel={t('install.menuLabel', { name: automationName })}
        triggerClassName={triggerClassName}
        disabled={busy || reinstallPending || exporting}
      />

      {reinstallDialog}

      <ConfirmDialog
        open={dialogs.isOpen.removeFromProject}
        onOpenChange={dialogs.setOpen.removeFromProject}
        title={t('install.removeFromProjectTitle')}
        description={t('install.removeFromProjectDescription', {
          name: automationName,
        })}
        confirmText={t('install.removeFromProject')}
        isLoading={busy}
        onConfirm={() => void handleRemoveFromProject()}
      />

      {bundle && (
        <DeleteDialog
          open={dialogs.isOpen.uninstallBundle}
          onOpenChange={dialogs.setOpen.uninstallBundle}
          title={t('install.uninstallBundleTitle')}
          description={t('install.uninstallBundleDescription', {
            count: bundle.memberCount,
          })}
          preview={{ primary: bundle.name }}
          warning={t('install.uninstallWarning')}
          deleteText={t('install.uninstallBundle')}
          isDeleting={busy}
          onDelete={() => void handleUninstallBundle()}
        />
      )}

      <DeleteDialog
        open={dialogs.isOpen.uninstall}
        onOpenChange={dialogs.setOpen.uninstall}
        title={t('install.uninstallTitle')}
        description={t('install.uninstallDescription')}
        preview={{ primary: automationName }}
        warning={t('install.uninstallWarning')}
        deleteText={t('install.uninstall')}
        isDeleting={busy}
        onDelete={() => void handleUninstall()}
      />
    </>
  );
}
