'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { PageSection } from '@tale/ui/page-section';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { AlertCircle, Database, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { Select } from '@/app/components/ui/forms/select';
import { useListProviders } from '@/app/features/settings/providers/hooks/queries';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  defaultModelsConfigSchema,
  modelAccessConfigSchema,
  type DefaultModelsConfig,
  type DefaultModelRule,
  type ModelAccessConfig,
} from '@/lib/shared/schemas/governance';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { RulesTableEmptyState } from './rules-table-empty-state';

function stripQualifier(s: string): string {
  const idx = s.indexOf(':');
  return idx === -1 ? s : s.slice(idx + 1);
}

/**
 * Simulate which model_access rule applies to a user who matches the given
 * default-model rule's scope, and decide whether the chosen model would be
 * denied. Mirrors the backend priority: team > role > default (user scope is
 * not a valid default-model scope).
 */
function computeAccessConflict(
  accessConfig: ModelAccessConfig | null,
  rule: DefaultModelRule,
): 'allowlist' | 'blocklist' | null {
  if (!rule.modelId) return null;
  if (!accessConfig || !accessConfig.enabled || accessConfig.rules.length === 0)
    return null;

  let matched = undefined as (typeof accessConfig.rules)[number] | undefined;
  if (rule.scope === 'team' && rule.scopeId) {
    matched = accessConfig.rules.find(
      (r) => r.scope === 'team' && r.scopeId === rule.scopeId,
    );
  }
  if (!matched && rule.scope === 'role' && rule.scopeId) {
    matched = accessConfig.rules.find(
      (r) => r.scope === 'role' && r.scopeId === rule.scopeId,
    );
  }
  if (!matched) {
    matched = accessConfig.rules.find((r) => r.scope === 'default');
  }
  if (!matched) return null;

  const target = stripQualifier(rule.modelId);
  const blocked = (matched.blockedModels ?? []).map(stripQualifier);
  if (blocked.includes(target)) return 'blocklist';

  const allowed = matched.allowedModels.map(stripQualifier);
  if (accessConfig.mode === 'allowlist' && !allowed.includes(target))
    return 'allowlist';

  return null;
}

function parseModelAccessConfig(policy: unknown): ModelAccessConfig | null {
  const config = isRecord(policy) ? policy : null;
  if (!config) return null;
  const result = modelAccessConfigSchema.safeParse(config);
  return result.success ? result.data : null;
}

interface DefaultModelEditorProps {
  organizationId: string;
}

const SCOPE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'team', label: 'Team' },
  { value: 'role', label: 'Role' },
];

function isScopeValue(v: string): v is DefaultModelRule['scope'] {
  return SCOPE_OPTIONS.some((o) => o.value === v);
}

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'developer', label: 'Developer' },
  { value: 'editor', label: 'Editor' },
  { value: 'member', label: 'Member' },
];

function emptyRule(): DefaultModelRule {
  return {
    scope: 'default',
    providerName: '',
    modelId: '',
  };
}

function parseDefaultModelsConfig(policy: unknown): DefaultModelsConfig {
  const config = isRecord(policy) ? policy : {};
  const result = defaultModelsConfigSchema.safeParse(config);
  if (result.success) {
    return result.data;
  }
  return { enabled: false, rules: [] };
}

interface ProviderModel {
  id: string;
  displayName: string;
  tags: string[];
}

interface ProviderInfo {
  name: string;
  displayName: string;
  models: ProviderModel[];
}

interface RuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: DefaultModelRule;
  onSave: (rule: DefaultModelRule) => void;
  title: string;
  cannotManage: boolean;
  teamOptions: { value: string; label: string }[];
  providerList: ProviderInfo[];
  accessConfig: ModelAccessConfig | null;
}

const PLACEHOLDER_ROW_COUNT = 3;

function RuleDialog({
  open,
  onOpenChange,
  rule: initialRule,
  onSave,
  title,
  cannotManage,
  teamOptions,
  providerList,
  accessConfig,
}: RuleDialogProps) {
  const { t } = useT('governance');
  const [draft, setDraft] = useState(initialRule);

  useEffect(() => {
    if (open) {
      setDraft(initialRule);
    }
  }, [open, initialRule]);

  const updateDraft = useCallback((patch: Partial<DefaultModelRule>) => {
    setDraft((prev) => {
      const updated = { ...prev, ...patch };
      if (patch.scope !== undefined) {
        if (patch.scope === 'default') {
          delete updated.scopeId;
        } else {
          updated.scopeId = '';
        }
      }
      if (patch.providerName && patch.providerName !== prev.providerName) {
        updated.modelId = '';
      }
      return updated;
    });
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!draft.providerName || !draft.modelId) return;
      if (draft.scope !== 'default' && !draft.scopeId) return;
      onSave(draft);
      onOpenChange(false);
    },
    [draft, onSave, onOpenChange],
  );

  const providerOptions = useMemo(
    () =>
      providerList.map((p) => ({
        value: p.name,
        label: p.displayName || p.name,
      })),
    [providerList],
  );

  const modelOptions = useMemo(() => {
    const provider = providerList.find((p) => p.name === draft.providerName);
    if (!provider) return [];
    return provider.models
      .filter((m) => m.tags.includes('chat'))
      .map((m) => ({
        value: m.id,
        label: m.displayName || m.id,
      }));
  }, [providerList, draft.providerName]);

  const conflict = useMemo(
    () => computeAccessConflict(accessConfig, draft),
    [accessConfig, draft],
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      onSubmit={handleSubmit}
      submitText={t('defaultModels.confirm')}
    >
      <Stack gap={4}>
        <HStack gap={3} align="end">
          <div className="flex-1">
            <Select
              label={t('defaultModels.scope')}
              options={SCOPE_OPTIONS}
              value={draft.scope}
              onValueChange={(value: string) => {
                if (isScopeValue(value)) {
                  updateDraft({ scope: value });
                }
              }}
              disabled={cannotManage}
              size="sm"
            />
          </div>

          {draft.scope === 'role' && (
            <div className="flex-1">
              <Select
                label={t('defaultModels.role')}
                options={ROLE_OPTIONS}
                value={draft.scopeId ?? ''}
                onValueChange={(value) => updateDraft({ scopeId: value })}
                disabled={cannotManage}
                size="sm"
              />
            </div>
          )}

          {draft.scope === 'team' && (
            <div className="flex-1">
              <SearchableSelect
                label={t('defaultModels.target')}
                placeholder={t('defaultModels.selectTeam')}
                size="sm"
                disabled={cannotManage}
                value={draft.scopeId ?? null}
                onValueChange={(value) => updateDraft({ scopeId: value })}
                options={teamOptions}
                searchPlaceholder={t('defaultModels.searchTeams')}
                emptyText={t('defaultModels.noTeamsFound')}
                aria-label={t('defaultModels.target')}
              />
            </div>
          )}
        </HStack>

        <SearchableSelect
          label={t('defaultModels.provider')}
          placeholder={t('defaultModels.selectProvider')}
          size="sm"
          disabled={cannotManage}
          value={draft.providerName || null}
          onValueChange={(value) => updateDraft({ providerName: value })}
          options={providerOptions}
          searchPlaceholder={t('defaultModels.searchProviders')}
          emptyText={t('defaultModels.noProvidersFound')}
          aria-label={t('defaultModels.provider')}
        />

        <SearchableSelect
          label={t('defaultModels.model')}
          placeholder={t('defaultModels.selectModel')}
          size="sm"
          disabled={cannotManage || !draft.providerName}
          value={draft.modelId || null}
          onValueChange={(value) => updateDraft({ modelId: value })}
          options={modelOptions}
          searchPlaceholder={t('defaultModels.searchModels')}
          emptyText={t('defaultModels.noModelsFound')}
          aria-label={t('defaultModels.model')}
        />

        {conflict && (
          <Alert
            variant="warning"
            icon={AlertCircle}
            title={t(
              conflict === 'allowlist'
                ? 'defaultModels.allowlistConflictWarningTitle'
                : 'defaultModels.blocklistConflictWarningTitle',
            )}
            description={t(
              conflict === 'allowlist'
                ? 'defaultModels.allowlistConflictWarning'
                : 'defaultModels.blocklistConflictWarning',
            )}
          />
        )}
      </Stack>
    </FormDialog>
  );
}

// =============================================================================
// Single editor — owns data fetching, local rule/dialog state, save/toast
// wiring, and the loading state. Renders the REAL header + rules table +
// dialogs once, always, wrapped in `<Skeletonize>`. The table renders
// placeholder rows while loading so an empty body never reads as "no rules"
// mid-load.
// =============================================================================
export function DefaultModelEditor({
  organizationId,
}: DefaultModelEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading: loading } = useGovernancePolicy(
    organizationId,
    'default_models',
  );
  const { data: accessPolicy } = useGovernancePolicy(
    organizationId,
    'model_access',
  );
  const upsertMutation = useUpsertGovernancePolicy();
  const { teams } = useOrgTeams();
  const { providers } = useListProviders(organizationId);

  const accessConfig = useMemo(
    () => parseModelAccessConfig(accessPolicy?.config),
    [accessPolicy],
  );

  const teamOptions = useMemo(
    () =>
      (teams ?? []).map((team) => ({
        value: team.id,
        label: team.name || team.id,
      })),
    [teams],
  );

  const providerList = useMemo<ProviderInfo[]>(() => {
    const list: ProviderInfo[] = [];
    for (const provider of providers) {
      if (
        !provider ||
        !('models' in provider) ||
        !Array.isArray(provider.models)
      )
        continue;
      list.push({
        name: provider.name,
        displayName: provider.displayName ?? provider.name,
        models: provider.models.map(
          (m: { id: string; displayName: string; tags?: string[] }) => ({
            id: m.id,
            displayName: m.displayName,
            tags: m.tags ?? [],
          }),
        ),
      });
    }
    return list;
  }, [providers]);

  // Memoize on the consumed value (`policy?.config`), not the `policy` wrapper.
  // A query hook that hands back a fresh wrapper object each render would
  // otherwise give `savedConfig` a new identity every render, and the
  // `[savedConfig]` effect below would `setRules` in a loop.
  const savedConfig = useMemo(
    () => parseDefaultModelsConfig(policy?.config),
    [policy?.config],
  );

  const [rules, setRules] = useState<DefaultModelRule[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [dialogRule, setDialogRule] = useState(emptyRule());
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  useEffect(() => {
    setRules(savedConfig.rules);
  }, [savedConfig]);

  const cannotManage = ability.cannot('write', 'orgSettings');

  const saveConfig = useCallback(
    async (nextRules: DefaultModelRule[]) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'default_models',
          // `enabled` is always true from the UI — rules presence drives
          // enforcement (server short-circuits on `!enabled || rules.length === 0`).
          config: { enabled: true, rules: nextRules },
        });
        toast({
          title: t('toastSavedTitle'),
          description: t('defaultModels.saved'),
          variant: 'success',
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Failed to save';
        toast({
          title: t('toastSaveFailedTitle'),
          description: message,
          variant: 'destructive',
        });
      }
    },
    [organizationId, upsertMutation, toast, t],
  );

  const confirmRemoveRule = useCallback(() => {
    if (deletingIndex === null) return;
    const newRules = rules.filter((_, i) => i !== deletingIndex);
    setRules(newRules);
    setDeletingIndex(null);
    void saveConfig(newRules);
  }, [deletingIndex, rules, saveConfig]);

  const openAddDialog = useCallback(() => {
    setEditingIndex(null);
    setDialogRule(emptyRule());
    setDialogOpen(true);
  }, []);

  const openEditDialog = useCallback(
    (index: number) => {
      setEditingIndex(index);
      setDialogRule(rules[index]);
      setDialogOpen(true);
    },
    [rules],
  );

  const handleDialogSave = useCallback(
    (rule: DefaultModelRule) => {
      let newRules: DefaultModelRule[];
      if (editingIndex === null) {
        // Replace any existing rule with the same scope+target instead of duplicating
        const existingIndex = rules.findIndex(
          (r) => r.scope === rule.scope && r.scopeId === rule.scopeId,
        );
        if (existingIndex !== -1) {
          newRules = rules.map((r, i) => (i === existingIndex ? rule : r));
        } else {
          newRules = [...rules, rule];
        }
      } else {
        newRules = rules.map((r, i) => (i === editingIndex ? rule : r));
      }
      setRules(newRules);
      void saveConfig(newRules);
    },
    [editingIndex, rules, saveConfig],
  );

  const resolveTarget = useCallback(
    (rule: DefaultModelRule): string => {
      switch (rule.scope) {
        case 'team': {
          if (!rule.scopeId) return '—';
          return (
            teamOptions.find((o) => o.value === rule.scopeId)?.label ??
            rule.scopeId
          );
        }
        case 'role':
          return (
            ROLE_OPTIONS.find((o) => o.value === rule.scopeId)?.label ??
            rule.scopeId ??
            '—'
          );
        case 'default':
          return t('defaultModels.allUsers');
        default:
          return '—';
      }
    },
    [teamOptions, t],
  );

  const resolveModelName = useCallback(
    (rule: DefaultModelRule): string => {
      for (const provider of providerList) {
        if (provider.name !== rule.providerName) continue;
        const model = provider.models.find((m) => m.id === rule.modelId);
        if (model) return model.displayName;
      }
      return rule.modelId;
    },
    [providerList],
  );

  const resolveProviderName = useCallback(
    (rule: DefaultModelRule): string => {
      const provider = providerList.find((p) => p.name === rule.providerName);
      return provider?.displayName ?? rule.providerName;
    },
    [providerList],
  );

  // While loading, render fixed placeholder rows so the table occupies the
  // same height as real content and reads as "loading", not "empty".
  const displayRows = loading
    ? Array.from({ length: PLACEHOLDER_ROW_COUNT }, (_, i) => ({
        __placeholder: i,
      }))
    : rules;

  return (
    <Skeletonize loading={loading} label={t('defaultModels.title')}>
      <PageSection
        title={t('defaultModels.title')}
        description={t('defaultModels.description')}
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={openAddDialog}
            disabled={cannotManage}
          >
            <Plus className="mr-1.5 size-4" />
            {t('defaultModels.addRule')}
          </Button>
        }
      >
        <div className="border-border overflow-hidden rounded-lg border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('defaultModels.title')}</caption>
              <thead className="bg-muted/50">
                <tr className="border-border border-b">
                  <th
                    scope="col"
                    className="text-muted-foreground px-3 py-2 text-left font-medium"
                  >
                    {t('defaultModels.scope')}
                  </th>
                  <th
                    scope="col"
                    className="text-muted-foreground px-3 py-2 text-left font-medium"
                  >
                    {t('defaultModels.target')}
                  </th>
                  <th
                    scope="col"
                    className="text-muted-foreground px-3 py-2 text-left font-medium"
                  >
                    {t('defaultModels.provider')}
                  </th>
                  <th
                    scope="col"
                    className="text-muted-foreground px-3 py-2 text-left font-medium"
                  >
                    {t('defaultModels.model')}
                  </th>
                  <th
                    scope="col"
                    className="text-muted-foreground px-3 py-2 text-right font-medium"
                  >
                    {t('defaultModels.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  displayRows.map((_, index) => (
                    <tr
                      key={`skeleton-${index}`}
                      className="border-border border-b last:border-b-0"
                    >
                      <td className="px-3 py-2">
                        <SkeletonBox>
                          <div className="h-3.5 w-16" />
                        </SkeletonBox>
                      </td>
                      <td className="px-3 py-2">
                        <SkeletonBox>
                          <div className="h-3.5 w-24" />
                        </SkeletonBox>
                      </td>
                      <td className="px-3 py-2">
                        <SkeletonBox>
                          <div className="h-3.5 w-20" />
                        </SkeletonBox>
                      </td>
                      <td className="px-3 py-2">
                        <SkeletonBox>
                          <div className="h-3.5 w-28" />
                        </SkeletonBox>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <HStack gap={1} justify="end">
                          <SkeletonBox>
                            <div className="size-8 rounded-md" />
                          </SkeletonBox>
                          <SkeletonBox>
                            <div className="size-8 rounded-md" />
                          </SkeletonBox>
                        </HStack>
                      </td>
                    </tr>
                  ))
                ) : rules.length > 0 ? (
                  rules.map((rule, index) => (
                    <tr
                      key={index}
                      className="border-border border-b last:border-b-0"
                    >
                      <td className="px-3 py-2 capitalize">{rule.scope}</td>
                      <td className="px-3 py-2">{resolveTarget(rule)}</td>
                      <td className="px-3 py-2">{resolveProviderName(rule)}</td>
                      <td className="px-3 py-2">{resolveModelName(rule)}</td>
                      <td className="px-3 py-2 text-right">
                        <HStack gap={1} justify="end">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(index)}
                            disabled={cannotManage}
                            aria-label={t('defaultModels.editRule', {
                              index: index + 1,
                            })}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeletingIndex(index)}
                            disabled={cannotManage}
                            aria-label={t('defaultModels.removeRule', {
                              index: index + 1,
                            })}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </HStack>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="p-0">
                      <RulesTableEmptyState
                        icon={Database}
                        title={t('defaultModels.noRulesTitle')}
                        description={t('defaultModels.noRulesDescription')}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <RuleDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          rule={dialogRule}
          onSave={handleDialogSave}
          title={
            editingIndex === null
              ? t('defaultModels.addRuleTitle')
              : t('defaultModels.editRuleTitle')
          }
          cannotManage={cannotManage}
          teamOptions={teamOptions}
          providerList={providerList}
          accessConfig={accessConfig}
        />

        <ConfirmDialog
          open={deletingIndex !== null}
          onOpenChange={(open) => {
            if (!open) setDeletingIndex(null);
          }}
          title={t('defaultModels.removeRuleConfirmTitle')}
          description={t('defaultModels.removeRuleConfirmDescription')}
          confirmText={t('defaultModels.removeRuleConfirmAction')}
          variant="destructive"
          onConfirm={confirmRemoveRule}
        />
      </PageSection>
    </Skeletonize>
  );
}
