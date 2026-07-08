'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuItem } from '@tale/ui/dropdown-menu';
import { Row } from '@tale/ui/layout';
import { History, Sparkles } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import {
  EditorActions,
  useActiveEditor,
  useRegisterDirtySource,
} from '@/app/components/ui/editor';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import type { WorkflowJsonConfig } from '@/lib/shared/schemas/workflows';
import { workflowJsonSchema } from '@/lib/shared/schemas/workflows';

import { useWorkflowConfig } from '../hooks/use-workflow-config-context';
import { useWorkflowActivity } from '../triggers/hooks/queries';
import { WorkflowDiffDialog } from './workflow-diff-dialog';

interface WorkflowNavigationProps {
  organizationId: string;
  workflowId?: string;
  workflowSlug: string;
  onRefetch: () => Promise<void>;
  isAssistantOpen?: boolean;
  onOpenAssistant?: () => void;
}

interface HistoryEntry {
  timestamp: string;
  date: string;
}

export function WorkflowNavigation({
  organizationId,
  workflowId,
  workflowSlug,
  onRefetch,
  isAssistantOpen,
  onOpenAssistant,
}: WorkflowNavigationProps) {
  const { t } = useT('workflows');
  const { t: tCommon } = useT('common');
  const { formatDate } = useFormatDate();
  const { config, isDirty } = useWorkflowConfig();

  // Surface dirty state to the page-level blocker so navigation away from
  // the editor with unsaved workflow edits triggers the unified confirm.
  useRegisterDirtySource(isDirty);

  const showOpenAssistantButton = !!onOpenAssistant && !isAssistantOpen;

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

  const { hasActiveTrigger, isLoading: isActivityLoading } =
    useWorkflowActivity(organizationId, workflowSlug);

  const navigationItems: TabNavigationItem[] = workflowId
    ? [
        {
          label: t('navigation.editor'),
          href: `/dashboard/${organizationId}/workflows/${workflowId}`,
          matchMode: 'exact',
        },
        {
          label: t('executions.title'),
          href: `/dashboard/${organizationId}/workflows/${workflowId}/executions`,
        },
        {
          label: t('configuration.title'),
          href: `/dashboard/${organizationId}/workflows/${workflowId}/configuration`,
        },
        {
          label: t('triggers.title'),
          href: `/dashboard/${organizationId}/workflows/${workflowId}/triggers`,
          trailing:
            !isActivityLoading && !hasActiveTrigger ? (
              <span className="border-border bg-background text-foreground ml-2 inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs leading-4 font-medium">
                {tCommon('status.inactive')}
              </span>
            ) : null,
        },
      ]
    : [];

  const handleLoadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex action returns HistoryEntry[]
      const entries = (await listHistoryAction.mutateAsync({
        organizationId,
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
  }, [listHistoryAction, organizationId, workflowSlug, t]);

  const handleSelectEntry = useCallback(
    async (entry: HistoryEntry) => {
      try {
        const result = await readHistoryAction.mutateAsync({
          organizationId,
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
    [readHistoryAction, organizationId, workflowSlug, t],
  );

  const handleRestore = useCallback(async () => {
    if (!selectedEntry) return;
    setIsRestoring(true);
    try {
      await restoreAction.mutateAsync({
        organizationId,
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
  }, [
    onRefetch,
    restoreAction,
    selectedEntry,
    organizationId,
    workflowSlug,
    t,
  ]);

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

  if (!workflowId) {
    return null;
  }

  const assistantButton = showOpenAssistantButton ? (
    <Button
      variant="secondary"
      size="icon"
      className="size-8"
      onClick={onOpenAssistant}
      aria-label={t('navigation.openAssistant')}
      title={t('navigation.openAssistant')}
    >
      <Sparkles className="size-3.5" aria-hidden="true" />
    </Button>
  ) : null;

  const historyMenu = (
    <DropdownMenu
      trigger={
        <Button
          variant="secondary"
          className="h-8 text-sm"
          icon={History}
          iconClassName="size-3.5"
          collapseLabel
        >
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
  );

  return (
    <>
      <TabNavigation
        items={navigationItems}
        standalone={false}
        ariaLabel={tCommon('aria.workflowNavigation')}
      >
        <WorkflowEditorActionsSlot
          assistant={assistantButton}
          history={historyMenu}
        />
      </TabNavigation>

      {snapshotConfig && selectedEntry && (
        <WorkflowDiffDialog
          open={isDiffOpen}
          onOpenChange={setIsDiffOpen}
          currentConfig={config}
          candidateConfig={snapshotConfig}
          title={t('history.diffTitle')}
          description={t('history.diffDescription', {
            date: formatDate(new Date(selectedEntry.date), 'long'),
          })}
          confirmLabel={t('history.restore')}
          confirmVariant="destructive"
          isConfirming={isRestoring}
          onConfirm={() => void handleRestore()}
        />
      )}
    </>
  );
}

/**
 * Reads the active child controller (Configuration form, future tab forms)
 * and renders the unified Save/Discard cluster in the tab strip alongside
 * the History menu. Tabs without forms (Editor, Executions, Triggers) leave
 * the active editor null and only the History button shows.
 */
function WorkflowEditorActionsSlot({
  assistant,
  history,
}: {
  assistant?: React.ReactNode;
  history: React.ReactNode;
}) {
  const controller = useActiveEditor();
  if (!controller) {
    return (
      <Row gap={2} className="ml-auto">
        {assistant}
        {history}
      </Row>
    );
  }
  return (
    <EditorActions
      controller={controller}
      entityKind="workflow"
      history={
        <>
          {assistant}
          {history}
        </>
      }
    />
  );
}
