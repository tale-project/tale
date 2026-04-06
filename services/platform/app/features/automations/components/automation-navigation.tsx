'use client';

import { History } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import type { WorkflowJsonConfig } from '@/lib/shared/schemas/workflows';

import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import {
  DropdownMenu,
  type DropdownMenuItem,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Button } from '@/app/components/ui/primitives/button';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { workflowJsonSchema } from '@/lib/shared/schemas/workflows';

import { useWorkflowConfig } from '../hooks/use-workflow-config-context';
import { AutomationHistoryDiffDialog } from './automation-history-diff-dialog';

interface AutomationNavigationProps {
  organizationId: string;
  automationId?: string;
  workflowSlug: string;
  onRefetch: () => Promise<void>;
}

interface HistoryEntry {
  timestamp: string;
  date: string;
}

export function AutomationNavigation({
  organizationId,
  automationId,
  workflowSlug,
  onRefetch,
}: AutomationNavigationProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { formatDate } = useFormatDate();
  const { config } = useWorkflowConfig();

  const listHistoryAction = useConvexAction(
    api.workflows.file_actions.listHistory,
  );
  const readHistoryAction = useConvexAction(
    api.workflows.file_actions.readHistoryEntry,
  );
  const restoreAction = useConvexAction(
    api.workflows.file_actions.restoreFromHistory,
  );

  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [, setIsLoadingHistory] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [snapshotConfig, setSnapshotConfig] =
    useState<WorkflowJsonConfig | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isDiffOpen, setIsDiffOpen] = useState(false);

  const navigationItems: TabNavigationItem[] = automationId
    ? [
        {
          label: t('navigation.editor'),
          href: `/dashboard/${organizationId}/automations/${automationId}`,
          matchMode: 'exact',
        },
        {
          label: t('executions.title'),
          href: `/dashboard/${organizationId}/automations/${automationId}/executions`,
        },
        {
          label: t('configuration.title'),
          href: `/dashboard/${organizationId}/automations/${automationId}/configuration`,
        },
        {
          label: t('triggers.title'),
          href: `/dashboard/${organizationId}/automations/${automationId}/triggers`,
        },
      ]
    : [];

  const handleLoadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex action returns HistoryEntry[]
      const entries = (await listHistoryAction.mutateAsync({
        orgSlug: 'default',
        workflowSlug,
      })) as HistoryEntry[];
      setHistoryEntries(entries);
    } catch (err) {
      console.error(err);
      toast({
        title: t('history.loadFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsLoadingHistory(false);
    }
  }, [listHistoryAction, workflowSlug, t]);

  const handleSelectEntry = useCallback(
    async (entry: HistoryEntry) => {
      try {
        const result = await readHistoryAction.mutateAsync({
          orgSlug: 'default',
          workflowSlug,
          timestamp: entry.timestamp,
        });
        if (
          result &&
          typeof result === 'object' &&
          'ok' in result &&
          result.ok &&
          'config' in result
        ) {
          const parsed = workflowJsonSchema.safeParse(result.config);
          if (!parsed.success) return;
          setSelectedEntry(entry);
          setSnapshotConfig(parsed.data);
          setIsDiffOpen(true);
        }
      } catch (err) {
        console.error(err);
        toast({
          title: t('history.loadFailed'),
          variant: 'destructive',
        });
      }
    },
    [readHistoryAction, workflowSlug, t],
  );

  const handleRestore = useCallback(async () => {
    if (!selectedEntry) return;
    setIsRestoring(true);
    try {
      await restoreAction.mutateAsync({
        orgSlug: 'default',
        workflowSlug,
        timestamp: selectedEntry.timestamp,
      });
      setIsDiffOpen(false);
      setSelectedEntry(null);
      setSnapshotConfig(null);
      setHistoryEntries([]);
      toast({
        title: t('history.restoreSuccess'),
        variant: 'success',
      });
      await onRefetch();
    } catch (err) {
      console.error(err);
      toast({
        title: t('history.restoreFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsRestoring(false);
    }
  }, [onRefetch, restoreAction, selectedEntry, workflowSlug, t]);

  const historyMenuItems = useMemo(() => {
    if (historyEntries.length === 0) {
      return [
        [
          {
            type: 'item' as const,
            label: t('history.empty'),
            disabled: true,
          },
        ],
      ];
    }
    return [
      historyEntries.map<DropdownMenuItem>((entry) => ({
        type: 'item',
        label: formatDate(new Date(entry.date), 'long'),
        onClick: () => void handleSelectEntry(entry),
      })),
    ];
  }, [historyEntries, formatDate, handleSelectEntry, t]);

  if (!automationId) {
    return null;
  }

  return (
    <>
      <TabNavigation
        items={navigationItems}
        standalone={false}
        ariaLabel={tCommon('aria.automationsNavigation')}
      >
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu
            trigger={
              <Button variant="secondary" size="sm" className="h-8 text-sm">
                <History className="mr-1.5 size-3.5" aria-hidden="true" />
                {t('navigation.history')}
              </Button>
            }
            items={historyMenuItems}
            align="end"
            contentClassName="w-64"
            onOpenChange={(open) => {
              if (open) void handleLoadHistory();
            }}
          />
        </div>
      </TabNavigation>

      {snapshotConfig && selectedEntry && (
        <AutomationHistoryDiffDialog
          open={isDiffOpen}
          onOpenChange={setIsDiffOpen}
          currentConfig={config}
          snapshotConfig={snapshotConfig}
          snapshotDate={selectedEntry.date}
          isRestoring={isRestoring}
          onRestore={() => void handleRestore()}
        />
      )}
    </>
  );
}
