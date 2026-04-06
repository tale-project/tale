'use client';

import { useBlocker } from '@tanstack/react-router';
import { History, Loader2, Save, Undo2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import type { AgentJsonConfig } from '@/convex/agents/file_utils';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
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
import { agentJsonSchema } from '@/lib/shared/schemas/agents';

import { useAgentConfig } from '../hooks/use-agent-config-context';
import { HistoryDiffDialog } from './history-diff-dialog';

interface AgentNavigationProps {
  organizationId: string;
  agentId: string;
  onSaved: (config: AgentJsonConfig) => void;
}

interface HistoryEntry {
  timestamp: string;
  date: string;
}

export function AgentNavigation({
  organizationId,
  agentId,
  onSaved,
}: AgentNavigationProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { config, isDirty, isSaving, resetConfig, markSaving, overrideConfig } =
    useAgentConfig();
  const { formatDate } = useFormatDate();

  const snapshotAction = useConvexAction(
    api.agents.file_actions.snapshotToHistory,
  );
  const saveAction = useConvexAction(api.agents.file_actions.saveAgent);
  const listHistoryAction = useConvexAction(
    api.agents.file_actions.listHistory,
  );
  const readHistoryAction = useConvexAction(
    api.agents.file_actions.readHistoryEntry,
  );
  const restoreAction = useConvexAction(
    api.agents.file_actions.restoreFromHistory,
  );

  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [, setIsLoadingHistory] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [snapshotConfig, setSnapshotConfig] = useState<AgentJsonConfig | null>(
    null,
  );
  const [isRestoring, setIsRestoring] = useState(false);
  const [isDiffOpen, setIsDiffOpen] = useState(false);

  const blocker = useBlocker({
    shouldBlockFn: () => isDirty,
    enableBeforeUnload: () => isDirty,
    withResolver: true,
  });

  const basePath = `/dashboard/${organizationId}/agents/${agentId}`;

  const navigationItems: TabNavigationItem[] = [
    {
      label: t('agents.navigation.general'),
      href: basePath,
      matchMode: 'exact',
    },
    {
      label: t('agents.navigation.instructionsModel'),
      href: `${basePath}/instructions`,
      matchMode: 'exact',
    },
    {
      label: t('agents.navigation.tools'),
      href: `${basePath}/tools`,
      matchMode: 'exact',
    },
    {
      label: t('agents.navigation.knowledge'),
      href: `${basePath}/knowledge`,
      matchMode: 'exact',
    },
    {
      label: t('agents.navigation.delegation'),
      href: `${basePath}/delegation`,
      matchMode: 'exact',
    },
    {
      label: t('agents.navigation.conversationStarters'),
      href: `${basePath}/conversation-starters`,
      matchMode: 'exact',
    },
    {
      label: t('agents.navigation.webhook'),
      href: `${basePath}/webhook`,
      matchMode: 'exact',
    },
  ];

  const handleSave = useCallback(async () => {
    markSaving(true);
    try {
      await snapshotAction.mutateAsync({
        orgSlug: 'default',
        agentName: agentId,
      });
      await saveAction.mutateAsync({
        orgSlug: 'default',
        agentName: agentId,
        config,
      });

      setHistoryEntries([]);
      toast({
        title: t('agents.agentSaved'),
        variant: 'success',
      });
      onSaved(config);
    } catch (err) {
      console.error(err);
      toast({
        title: t('agents.agentSaveFailed'),
        variant: 'destructive',
      });
    } finally {
      markSaving(false);
    }
  }, [agentId, config, markSaving, onSaved, saveAction, snapshotAction, t]);

  const handleDiscard = useCallback(() => {
    resetConfig();
  }, [resetConfig]);

  const handleLoadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex action returns HistoryEntry[]
      const entries = (await listHistoryAction.mutateAsync({
        orgSlug: 'default',
        agentName: agentId,
      })) as HistoryEntry[];
      setHistoryEntries(entries);
    } catch (err) {
      console.error(err);
      toast({
        title: t('agents.historyLoadFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsLoadingHistory(false);
    }
  }, [agentId, listHistoryAction, t]);

  const handleSelectEntry = useCallback(
    async (entry: HistoryEntry) => {
      try {
        const result = await readHistoryAction.mutateAsync({
          orgSlug: 'default',
          agentName: agentId,
          timestamp: entry.timestamp,
        });
        if (
          result &&
          typeof result === 'object' &&
          'ok' in result &&
          result.ok &&
          'config' in result
        ) {
          const parsed = agentJsonSchema.safeParse(result.config);
          if (!parsed.success) return;
          setSelectedEntry(entry);
          setSnapshotConfig(parsed.data);
          setIsDiffOpen(true);
        }
      } catch (err) {
        console.error(err);
        toast({
          title: t('agents.historyLoadFailed'),
          variant: 'destructive',
        });
      }
    },
    [agentId, readHistoryAction, t],
  );

  const handleRestore = useCallback(async () => {
    if (!selectedEntry || !snapshotConfig) return;
    setIsRestoring(true);
    try {
      await restoreAction.mutateAsync({
        orgSlug: 'default',
        agentName: agentId,
        timestamp: selectedEntry.timestamp,
      });

      overrideConfig(snapshotConfig);
      setIsDiffOpen(false);
      setSelectedEntry(null);
      setSnapshotConfig(null);
      setHistoryEntries([]);
      toast({
        title: t('agents.historyRestored'),
        variant: 'success',
      });
      onSaved(snapshotConfig);
    } catch (err) {
      console.error(err);
      toast({
        title: t('agents.historyRestoreFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsRestoring(false);
    }
  }, [
    agentId,
    onSaved,
    overrideConfig,
    restoreAction,
    selectedEntry,
    snapshotConfig,
    t,
  ]);

  const historyMenuItems = useMemo(() => {
    if (historyEntries.length === 0) {
      return [
        [
          {
            type: 'item' as const,
            label: t('agents.history.empty'),
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

  return (
    <>
      <TabNavigation
        items={navigationItems}
        standalone={false}
        ariaLabel={tCommon('aria.agentsNavigation')}
      >
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu
            trigger={
              <Button variant="secondary" size="sm" className="h-8 text-sm">
                <History className="mr-1.5 size-3.5" aria-hidden="true" />
                {t('agents.navigation.history')}
              </Button>
            }
            items={historyMenuItems}
            align="end"
            contentClassName="w-64"
            onOpenChange={(open) => {
              if (open) void handleLoadHistory();
            }}
          />

          {isDirty && (
            <Button
              onClick={handleDiscard}
              variant="secondary"
              size="sm"
              disabled={isSaving}
            >
              <Undo2 className="mr-1.5 size-3.5" aria-hidden="true" />
              {tCommon('actions.discard')}
            </Button>
          )}

          <Button
            onClick={() => void handleSave()}
            disabled={!isDirty || isSaving}
            size="sm"
          >
            {isSaving ? (
              <Loader2
                className="mr-1.5 size-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Save className="mr-1.5 size-3.5" aria-hidden="true" />
            )}
            {isSaving ? tCommon('actions.saving') : tCommon('actions.save')}
          </Button>
        </div>
      </TabNavigation>

      {snapshotConfig && selectedEntry && (
        <HistoryDiffDialog
          open={isDiffOpen}
          onOpenChange={setIsDiffOpen}
          currentConfig={config}
          snapshotConfig={snapshotConfig}
          snapshotDate={selectedEntry.date}
          isRestoring={isRestoring}
          onRestore={() => void handleRestore()}
        />
      )}

      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
        title={t('agents.unsavedChanges.title')}
        description={t('agents.unsavedChanges.description')}
        confirmText={t('agents.unsavedChanges.leave')}
        cancelText={t('agents.unsavedChanges.stay')}
        variant="destructive"
        onConfirm={() => blocker.proceed?.()}
      />
    </>
  );
}
