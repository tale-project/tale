'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { History } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useRestoreAgentFromHistory } from '../hooks/mutations';
import { useAgentHistory } from '../hooks/queries';

/**
 * The agent's version trail: every save keeps the superseded file, and
 * restoring is additive (the current version is snapshotted first). Entries
 * are labelled by save time — the file IS the version, there is no message.
 */
export function AgentHistoryMenu({
  organizationId,
  slug,
  canEdit,
}: {
  organizationId: string;
  slug: string;
  canEdit: boolean;
}) {
  const { t } = useT('settings');
  const { formatDate } = useFormatDate();
  const historyQuery = useAgentHistory(organizationId, slug);
  const restore = useRestoreAgentFromHistory();
  const [pendingEntry, setPendingEntry] = useState<{
    entry: string;
    savedAt: number;
  } | null>(null);

  const historyData = historyQuery.data;
  const entries = useMemo(() => historyData ?? [], [historyData]);

  const items = useMemo<DropdownMenuGroup[]>(() => {
    if (entries.length === 0) {
      return [
        [
          {
            type: 'item' as const,
            label: t('agents.history.empty'),
            disabled: true,
            onClick: () => {},
          },
        ],
      ];
    }
    return [
      entries.map((entry) => ({
        type: 'item' as const,
        label: formatDate(new Date(entry.savedAt), 'long'),
        disabled: !canEdit,
        onClick: () => setPendingEntry(entry),
      })),
    ];
  }, [entries, canEdit, formatDate, t]);

  const confirmRestore = async () => {
    if (!pendingEntry) return;
    try {
      await restore.mutateAsync({
        organizationId,
        slug,
        entry: pendingEntry.entry,
      });
      toast({ title: t('agents.historyRestored'), variant: 'success' });
      setPendingEntry(null);
    } catch (error) {
      console.error('Failed to restore agent from history', error);
      toast({
        title: t('agents.historyRestoreFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <DropdownMenu
        align="end"
        trigger={
          <Button variant="secondary" aria-haspopup="menu">
            <History className="mr-1 size-4" />
            {t('agents.navigation.history')}
          </Button>
        }
        items={items}
      />

      <ConfirmDialog
        open={pendingEntry !== null}
        onOpenChange={(open) => {
          if (!open) setPendingEntry(null);
        }}
        title={t('agents.history.restore')}
        description={
          pendingEntry
            ? t('agents.history.diffDescription', {
                date: formatDate(new Date(pendingEntry.savedAt), 'long'),
              })
            : ''
        }
        confirmText={t('agents.history.restore')}
        isLoading={restore.isPending}
        onConfirm={() => void confirmRestore()}
      />
    </>
  );
}
