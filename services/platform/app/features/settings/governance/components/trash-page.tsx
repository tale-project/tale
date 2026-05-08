'use client';

import { Button } from '@tale/ui/button';
import { Skeleton } from '@tale/ui/skeleton';
import { Undo2 } from 'lucide-react';
import { useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Text } from '@/app/components/ui/typography/text';
import { useRestoreSoftDeletedRow } from '@/app/features/settings/governance/hooks/mutations';
import { useListTrashedRows } from '@/app/features/settings/governance/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import {
  SOFT_DELETE_RESOURCE_TYPES,
  type SoftDeleteResourceType,
} from '@/convex/governance/soft_delete_validators';
import { useT } from '@/lib/i18n/client';

interface Props {
  organizationId: string;
}

const VISIBLE_RESOURCE_TYPES: SoftDeleteResourceType[] =
  SOFT_DELETE_RESOURCE_TYPES.filter(
    (t) => t !== 'messageMetadata' && t !== 'workflowTriggerLog',
  );

interface RestoreTarget {
  resourceType: SoftDeleteResourceType;
  rowId: string;
  displayName: string;
  status: 'trashed' | 'expired';
}

export function TrashPage({ organizationId }: Props) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  const ability = useAbility();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<SoftDeleteResourceType>('thread');
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(
    null,
  );

  const trash = useListTrashedRows(organizationId, activeTab, true);
  const restoreMutation = useRestoreSoftDeletedRow();

  if (ability.cannot('write', 'orgSettings')) {
    return <AccessDenied message={t('trash.accessDenied', 'Admin only.')} />;
  }

  const handleRestore = async () => {
    if (!restoreTarget) return;
    try {
      await restoreMutation.mutateAsync({
        organizationId,
        resourceType: restoreTarget.resourceType,
        rowId: restoreTarget.rowId,
      });
      toast({
        title: t('trash.restore.restoredToast', 'Restored.'),
        variant: 'success',
      });
      setRestoreTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Restore failed';
      toast({
        title: t('trash.restore.failedToast', 'Failed to restore'),
        description: message,
        variant: 'destructive',
      });
    }
  };

  return (
    <PageSection
      title={t('trash.title', 'Trash')}
      description={t(
        'trash.description',
        'Recover retention-trashed records before they are permanently deleted at the end of the grace window.',
      )}
    >
      <div className="border-border flex flex-wrap gap-1 border-b">
        {VISIBLE_RESOURCE_TYPES.map((rt) => (
          <button
            key={rt}
            type="button"
            onClick={() => setActiveTab(rt)}
            className={
              rt === activeTab
                ? 'border-foreground text-foreground -mb-px border-b-2 px-3 py-2 text-sm font-medium'
                : 'text-muted-foreground hover:text-foreground -mb-px border-b-2 border-transparent px-3 py-2 text-sm'
            }
          >
            {t(`trash.tab.${rt}`, rt)}
          </button>
        ))}
      </div>

      {trash.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : !trash.data || trash.data.rows.length === 0 ? (
        <div className="border-border rounded-md border p-8 text-center">
          <Text className="text-muted-foreground text-sm">
            {t(
              'trash.empty',
              'Nothing in the trash for this category. Retention will move expired rows here once their grace window starts.',
            )}
          </Text>
        </div>
      ) : (
        <div className="border-border overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-border border-b">
              <tr>
                <th className="px-3 py-2 text-left font-medium">
                  {t('trash.column.name', 'Name')}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {t('trash.column.status', 'Status')}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {t('trash.column.statusChangedAt', 'Trashed')}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t('trash.column.actions', 'Actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {trash.data.rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.displayName ?? row.id}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        row.status === 'expired'
                          ? 'rounded bg-orange-500/15 px-2 py-0.5 text-xs text-orange-600'
                          : 'rounded bg-yellow-500/15 px-2 py-0.5 text-xs text-yellow-700'
                      }
                    >
                      {t(`trash.status.${row.status}`, row.status)}
                    </span>
                  </td>
                  <td className="text-muted-foreground px-3 py-2 text-xs">
                    {formatRelative(row.statusChangedAt ?? row.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={Undo2}
                      onClick={() =>
                        setRestoreTarget({
                          resourceType: activeTab,
                          rowId: row.id,
                          displayName: row.displayName ?? row.id,
                          status: row.status,
                        })
                      }
                    >
                      {t('trash.restore.label', 'Restore')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {trash.data.truncated && (
            <div className="text-muted-foreground border-border border-t px-3 py-2 text-xs">
              {t(
                'trash.truncated',
                'Showing first batch only. Restore older items via cleanup or contact support.',
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
        title={
          restoreTarget?.status === 'expired'
            ? t(
                'trash.restore.expiredTitle',
                'Restore retention-expired record?',
              )
            : t('trash.restore.trashedTitle', 'Restore record?')
        }
        description={
          restoreTarget?.status === 'expired'
            ? t(
                'trash.restore.expiredDescription',
                'This record was deleted by retention policy. Restoring overrides that policy and brings the record back to active. Audited.',
              )
            : t(
                'trash.restore.trashedDescription',
                'Bring this record back to active. It will return to its source list.',
              )
        }
        confirmText={t('trash.restore.confirm', 'Restore')}
        cancelText={tCommon('actions.cancel')}
        isLoading={restoreMutation.isPending}
        onConfirm={() => void handleRestore()}
        requireConfirmPhrase={
          restoreTarget?.status === 'expired' ? 'restore' : undefined
        }
        requireConfirmPhraseLabel={
          restoreTarget?.status === 'expired'
            ? t('trash.restore.expiredPhraseLabel', 'Type "restore" to confirm')
            : undefined
        }
      >
        {restoreTarget && (
          <Text className="text-muted-foreground font-mono text-xs">
            {restoreTarget.displayName}
          </Text>
        )}
      </ConfirmDialog>
    </PageSection>
  );
}

function formatRelative(ms: number): string {
  const elapsedMs = Date.now() - ms;
  if (elapsedMs < 60_000) return 'just now';
  const days = Math.floor(elapsedMs / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(elapsedMs / 3_600_000);
  if (hours >= 1) return `${hours}h ago`;
  const minutes = Math.floor(elapsedMs / 60_000);
  return `${minutes}m ago`;
}
