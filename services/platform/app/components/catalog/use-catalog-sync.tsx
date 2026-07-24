'use client';

import { RefreshCw } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { type DataTableActionMenuItem } from '@/app/components/ui/data-table/data-table-action-menu';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { useAbility } from '@/app/hooks/use-ability';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

/** The config domain a catalog page syncs. */
export type CatalogSyncDomain =
  | 'agents'
  | 'integrations'
  | 'automations'
  | 'skills';

interface UseCatalogSyncOptions {
  organizationId: string;
  domain: CatalogSyncDomain;
  /** Refresh the page's list after a sync changed something. */
  onSynced?: () => void | Promise<unknown>;
}

/**
 * Shared "Update from catalog" action for the catalog pages (agents,
 * integrations, apps): refreshes the org's builtin-named config
 * entries from the built-in catalog, after a confirm step that spells out the
 * overwrite. Replaced versions land in the domain's `.history/` trail, so a
 * sync is recoverable.
 *
 * Exposed as a dropdown item + confirm dialog so every page hosts the action
 * inside its primary action menu (Create agent, Add app, …) rather than as a
 * second header button. The item is `null` for roles without developer-settings
 * access — the same capability the server-side action enforces.
 */
export function useCatalogSync({
  organizationId,
  domain,
  onSynced,
}: UseCatalogSyncOptions): {
  /** Append to the page's action menu; `null` without developer-settings access. */
  menuItem: DataTableActionMenuItem | null;
  /** The confirm dialog the item opens — render once alongside the menu. */
  dialog: ReactNode;
} {
  const { t } = useT('catalogSync');
  const ability = useAbility();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { mutateAsync: syncDomain, isPending } = useConvexAction(
    api.organizations.builtin_sync.syncDomainFromBuiltin,
  );

  const handleConfirm = async () => {
    try {
      const result = await syncDomain({ organizationId, domain });
      setConfirmOpen(false);
      if (result.updated > 0) {
        toast({
          title: t('toast.updated', { count: result.updated }),
          variant: 'success',
        });
        await onSynced?.();
      } else {
        toast({ title: t('toast.upToDate') });
      }
    } catch {
      setConfirmOpen(false);
      toast({ title: t('toast.failed'), variant: 'destructive' });
    }
  };

  const menuItem: DataTableActionMenuItem | null = ability.can(
    'read',
    'developerSettings',
  )
    ? {
        // Named after what it touches ("Update built-in agents"), not the
        // mechanism — "catalog" means nothing next to Blank / Upload.
        label: t(`button.${domain}`),
        icon: RefreshCw,
        onClick: () => setConfirmOpen(true),
      }
    : null;

  const dialog = (
    <ConfirmDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title={t('confirm.title')}
      description={t('confirm.description')}
      confirmText={t('confirm.action')}
      loadingText={t('confirm.loading')}
      isLoading={isPending}
      onConfirm={() => void handleConfirm()}
    />
  );

  return { menuItem, dialog };
}
