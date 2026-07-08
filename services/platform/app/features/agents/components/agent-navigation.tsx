'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuItem } from '@tale/ui/dropdown-menu';
import { History } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import {
  EditorActions,
  useRegisterDirtySource,
  type EditorController,
} from '@/app/components/ui/editor';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { AgentJsonConfig } from '@/convex/agents/file_utils';
import { useT } from '@/lib/i18n/client';
import { agentJsonSchema } from '@/lib/shared/schemas/agents';
import { canonicalizeAgentConfig } from '@/lib/shared/utils/canonicalize-config';
import { getOrganizationDefaultLocale } from '@/lib/shared/utils/get-organization-default-locale';
import { normalizeAgentConfig } from '@/lib/shared/utils/normalize-agent-config';
import { changedKeys } from '@/lib/utils/structural-equal';

import { useOrganization } from '../../organization/hooks/queries';
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

/**
 * Top-level keys per tab. Powers the per-tab dirty dot via
 * `controller.dirtyKeys` ∩ `tab.dirtyKeys`. Webhook has no top-level
 * fields in `agentJsonSchema` today so it never lights up.
 */
const AGENT_TAB_DIRTY_KEYS = {
  general: [
    'displayName',
    'description',
    'avatarUrl',
    'primaryBehavior',
    'agentKind',
    'visibleInChat',
    'roleRestriction',
    'composerMode',
    'i18n',
    // The execution-timeout input is rendered on the General tab, so its
    // diff key belongs here for the per-tab unsaved-changes indicator.
    'timeoutMs',
  ],
  instructions: [
    'systemInstructions',
    'supportedModels',
    'provider',
    'authMode',
    'nativeWebTools',
    'structuredResponsesEnabled',
    'maxSteps',
    'outputReserve',
    'personalizationMode',
  ],
  tools: [
    'toolNames',
    'integrationBindings',
    'workflows',
    'maxIntegrationCallsPerRun',
  ],
  skills: ['skillBindings'],
  knowledge: [
    'knowledgeMode',
    'webSearchMode',
    'includeOrgKnowledge',
    'includeTeamKnowledge',
    'knowledgeTopK',
  ],
  conversationStarters: ['conversationStarters'],
  webhook: [],
  // Env/secrets live in the `agentEnv` side-table, not the agent file — so this
  // tab never lights the config dirty-dot.
  environment: [],
} as const;

function computeDirtyKeys(
  config: AgentJsonConfig | null | undefined,
  savedConfig: AgentJsonConfig | null | undefined,
): ReadonlySet<string> {
  if (!config || !savedConfig) return new Set<string>();
  // Compare canonical forms so a set-like array reordered on disk doesn't
  // light up a tab's dirty dot when `isDirty` (also canonical) reads clean.
  // oxlint-disable typescript/no-unsafe-type-assertion -- record reflection
  const cfg = canonicalizeAgentConfig(config) as unknown as Record<
    string,
    unknown
  >;
  const saved = canonicalizeAgentConfig(savedConfig) as unknown as Record<
    string,
    unknown
  >;
  // oxlint-enable typescript/no-unsafe-type-assertion
  return changedKeys(cfg, saved);
}

export function AgentNavigation({
  organizationId,
  agentId,
  onSaved,
}: AgentNavigationProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const {
    config,
    initialConfig,
    isDirty,
    isSaving,
    resetConfig,
    markSaving,
    overrideConfig,
  } = useAgentConfig();
  const { formatDate } = useFormatDate();
  const { data: organization } = useOrganization(organizationId);
  const orgDefaultLocale = getOrganizationDefaultLocale(organization?.metadata);

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

  // Register with the page-level DirtyBlockerProvider so the unsaved-changes
  // dialog fires on navigation away from the agent editor.
  useRegisterDirtySource(isDirty);

  // Encode the agent id: app-owned agents have a composite slug
  // (`<app>/<name>`), and its `/` must stay a single path segment (`%2F`) so the
  // nested tab routes (`$agentId/instructions`, …) resolve. Flat global slugs
  // are unaffected (encodeURIComponent is a no-op for them).
  const basePath = `/dashboard/${organizationId}/agents/${encodeURIComponent(agentId)}`;

  // Chat agents use the platform tool loop for skills (expand_skill). External
  // agents stage bound org skills into the sandbox skill dir — same tab, different
  // runtime. Knowledge stays chat-only (RAG / web search mode).
  const isChat = (config.primaryBehavior ?? 'chat') === 'chat';
  const isExternalAgent = config.primaryBehavior === 'external-agent';

  const navigationItems: TabNavigationItem[] = [
    {
      label: t('agents.navigation.general'),
      href: basePath,
      matchMode: 'exact',
      dirtyKeys: AGENT_TAB_DIRTY_KEYS.general,
    },
    {
      label: t('agents.navigation.instructionsModel'),
      href: `${basePath}/instructions`,
      matchMode: 'exact',
      dirtyKeys: AGENT_TAB_DIRTY_KEYS.instructions,
    },
    ...(isChat || isExternalAgent
      ? [
          {
            label: t('agents.navigation.tools'),
            href: `${basePath}/tools`,
            matchMode: 'exact' as const,
            dirtyKeys: AGENT_TAB_DIRTY_KEYS.tools,
          },
        ]
      : []),
    ...(isChat || isExternalAgent
      ? [
          {
            label: t('agents.navigation.skills'),
            href: `${basePath}/skills`,
            matchMode: 'exact' as const,
            dirtyKeys: AGENT_TAB_DIRTY_KEYS.skills,
          },
        ]
      : []),
    ...(isChat
      ? [
          {
            label: t('agents.navigation.knowledge'),
            href: `${basePath}/knowledge`,
            matchMode: 'exact' as const,
            dirtyKeys: AGENT_TAB_DIRTY_KEYS.knowledge,
          },
        ]
      : []),
    {
      label: t('agents.navigation.conversationStarters'),
      href: `${basePath}/conversation-starters`,
      matchMode: 'exact',
      dirtyKeys: AGENT_TAB_DIRTY_KEYS.conversationStarters,
    },
    {
      label: t('agents.navigation.webhook'),
      href: `${basePath}/webhook`,
      matchMode: 'exact',
      dirtyKeys: AGENT_TAB_DIRTY_KEYS.webhook,
    },
    {
      label: t('agents.navigation.environment'),
      href: `${basePath}/environment`,
      matchMode: 'exact',
      dirtyKeys: AGENT_TAB_DIRTY_KEYS.environment,
    },
  ];

  const dirtyKeys = useMemo(
    () => computeDirtyKeys(config, initialConfig),
    [config, initialConfig],
  );

  const doSave = useCallback(async () => {
    markSaving(true);
    const priorBaseline = initialConfig;
    try {
      // Save first; only snapshot the prior baseline if the save succeeds.
      // The legacy order (snapshot → save) left a no-op history entry when
      // save failed; this is the inherited bug we're fixing.
      const normalized = normalizeAgentConfig(config, orgDefaultLocale);
      await saveAction.mutateAsync({
        organizationId,
        agentName: agentId,
        config,
      });

      // Best-effort history snapshot of the PRIOR baseline. Failure is logged
      // but does not roll back the save.
      snapshotAction
        .mutateAsync({ organizationId, agentName: agentId })
        .catch((err) =>
          console.warn('[agent history snapshot]', err, priorBaseline),
        );

      overrideConfig(normalized);
      setHistoryEntries([]);
      toast({
        title: t('agents.agentSaved'),
        variant: 'success',
      });
      onSaved(normalized);
    } catch (err) {
      console.error('[agent save]', err);
      toast({
        title: t('agents.agentSaveFailed'),
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
      throw err;
    } finally {
      markSaving(false);
    }
  }, [
    agentId,
    config,
    initialConfig,
    markSaving,
    onSaved,
    orgDefaultLocale,
    organizationId,
    overrideConfig,
    saveAction,
    snapshotAction,
    t,
  ]);

  // Build an `EditorController` from the legacy context so `EditorActions`
  // (and any future per-tab consumers) get the unified shape.
  const editorController: EditorController = useMemo(
    () => ({
      isDirty,
      isSaving,
      isValid: true,
      isLoading: false,
      dirtyKeys,
      save: doSave,
      reset: resetConfig,
    }),
    [doSave, dirtyKeys, isDirty, isSaving, resetConfig],
  );

  const handleLoadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex action returns HistoryEntry[]
      const entries = (await listHistoryAction.mutateAsync({
        organizationId,
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
  }, [agentId, listHistoryAction, organizationId, t]);

  const handleSelectEntry = useCallback(
    async (entry: HistoryEntry) => {
      try {
        const result = await readHistoryAction.mutateAsync({
          organizationId,
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
          if (parsed.success) {
            setSelectedEntry(entry);
            setSnapshotConfig(parsed.data);
            setIsDiffOpen(true);
            return;
          }
        }
        // The read resolved but yielded nothing loadable — a missing, corrupt,
        // or schema-divergent snapshot. Tell the user instead of silently doing
        // nothing (a click that opens no diff otherwise reads as a freeze).
        toast({
          title: t('agents.historyLoadFailed'),
          variant: 'destructive',
        });
      } catch (err) {
        console.error(err);
        toast({
          title: t('agents.historyLoadFailed'),
          variant: 'destructive',
        });
      }
    },
    [agentId, readHistoryAction, organizationId, t],
  );

  const handleRestore = useCallback(async () => {
    if (!selectedEntry || !snapshotConfig) return;
    setIsRestoring(true);
    try {
      await restoreAction.mutateAsync({
        organizationId,
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
    organizationId,
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
        dirtyKeys={dirtyKeys}
      >
        <EditorActions
          controller={editorController}
          entityKind="agent"
          history={
            <DropdownMenu
              trigger={
                <Button
                  variant="secondary"
                  size="sm"
                  icon={History}
                  iconClassName="size-3.5"
                  collapseLabel
                >
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
          }
        />
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
    </>
  );
}
