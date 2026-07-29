'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { HStack, Row, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tale/ui/table';
import { AlertCircle, Database, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { ModelInfoPopover } from '@/app/features/shared/models/model-info-popover';
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
import { isRecord } from '@/lib/utils/type-utils';

import { mapGovernanceSaveError } from '../governance-save-errors';
import { useListProviders, useModelCapabilities } from '../hooks/model-catalog';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { useGovernancePolicyToggle } from '../hooks/use-governance-policy-toggle';
import { stripQualifier } from './model-id';
import { ROLE_OPTIONS } from './role-options';
import { RulesTableEmptyState } from './rules-table-empty-state';

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
  organizationId: string;
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
  organizationId,
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

  const chatModels = useMemo(() => {
    const provider = providerList.find((p) => p.name === draft.providerName);
    return provider?.models.filter((m) => m.tags.includes('chat')) ?? [];
  }, [providerList, draft.providerName]);

  const modelOptions = useMemo(
    () =>
      chatModels.map((m) => ({
        value: m.id,
        label: m.displayName || m.id,
      })),
    [chatModels],
  );

  // Only subscribe to capabilities (a per-model indexed read fan-out) while the
  // dialog is open — RuleDialog stays mounted when closed, so an ungated hook
  // would keep a live subscription on this non-critical settings path.
  const capabilities = useModelCapabilities(
    organizationId,
    useMemo(
      () => (open ? chatModels.map((m) => m.id) : []),
      [open, chatModels],
    ),
  );

  const renderModelInfo = useCallback(
    (option: SearchableSelectOption) => {
      const model = chatModels.find((m) => m.id === option.value);
      if (!model) return null;
      return (
        <ModelInfoPopover
          tags={model.tags}
          capabilities={capabilities.get(model.id)}
          organizationId={organizationId}
        />
      );
    },
    [chatModels, capabilities, organizationId],
  );

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
        />

        {draft.scope === 'role' && (
          <Select
            label={t('defaultModels.role')}
            options={ROLE_OPTIONS}
            value={draft.scopeId ?? ''}
            onValueChange={(value) => updateDraft({ scopeId: value })}
            disabled={cannotManage}
          />
        )}

        {draft.scope === 'team' && (
          <SearchableSelect
            label={t('defaultModels.target')}
            placeholder={t('defaultModels.selectTeam')}
            disabled={cannotManage}
            value={draft.scopeId ?? null}
            onValueChange={(value) => updateDraft({ scopeId: value })}
            options={teamOptions}
            searchPlaceholder={t('defaultModels.searchTeams')}
            emptyText={t('defaultModels.noTeamsFound')}
            aria-label={t('defaultModels.target')}
          />
        )}

        <SearchableSelect
          label={t('defaultModels.provider')}
          placeholder={t('defaultModels.selectProvider')}
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
          disabled={cannotManage || !draft.providerName}
          value={draft.modelId || null}
          onValueChange={(value) => updateDraft({ modelId: value })}
          options={modelOptions}
          optionAction={renderModelInfo}
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

  // The section's toggle. Rules are kept when it goes off, so turning the
  // feature back on restores them; enforcement short-circuits on
  // `!enabled || rules.length === 0` server-side either way.
  const { enabled, isToggling, onToggle } = useGovernancePolicyToggle({
    organizationId,
    policyType: 'default_models',
    savedEnabled: savedConfig.enabled,
    isLoading: loading,
    buildConfig: (next) => ({ enabled: next, rules: savedConfig.rules }),
    failureTitle: t('toastSaveFailedTitle'),
    failureDescription: t('defaultModels.saveFailed'),
  });

  const saveConfig = useCallback(
    async (nextRules: DefaultModelRule[]) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'default_models',
          // A rule edit is only reachable while the section is on.
          config: { enabled: true, rules: nextRules },
        });
        toast({
          title: t('toastSavedTitle'),
          description: t('defaultModels.saved'),
          variant: 'success',
        });
      } catch (error: unknown) {
        toast({
          title: t('toastSaveFailedTitle'),
          description: mapGovernanceSaveError(
            error,
            t,
            t('defaultModels.saveFailed'),
          ),
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
      <SettingsSection
        // Section divider matches Preferences / Account: first block on the
        // page stays plain; later chapters get a hairline + pt-8.
        title={t('defaultModels.title')}
        description={t('defaultModels.description')}
        action={
          <Switch
            aria-label={t('defaultModels.title')}
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={cannotManage || isToggling}
          />
        }
      >
        {/* The rule table exists only while the section is on — a toggle hides
            its content rather than showing rules nothing enforces. It stays
            mounted (masked) while loading so the skeleton keeps the real
            shape; `enabled` is only known once the read settles. Add rule
            sits under the table, where Model access has it. */}
        {(loading || enabled) && (
          <Stack gap={4}>
            <Row justify="end">
              <Button
                variant="primary"
                onClick={openAddDialog}
                disabled={cannotManage}
              >
                <Plus className="mr-1.5 size-4" />
                {t('defaultModels.addRule')}
              </Button>
            </Row>
            <Card padding="none" className="overflow-hidden">
              <Table>
                <TableCaption className="sr-only">
                  {t('defaultModels.title')}
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('defaultModels.scope')}</TableHead>
                    <TableHead>{t('defaultModels.target')}</TableHead>
                    <TableHead>{t('defaultModels.provider')}</TableHead>
                    <TableHead>{t('defaultModels.model')}</TableHead>
                    <TableHead className="text-right">
                      {t('defaultModels.actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    displayRows.map((_, index) => (
                      <TableRow key={`skeleton-${index}`}>
                        <TableCell>
                          <SkeletonBox>
                            <div className="h-3.5 w-16" />
                          </SkeletonBox>
                        </TableCell>
                        <TableCell>
                          <SkeletonBox>
                            <div className="h-3.5 w-24" />
                          </SkeletonBox>
                        </TableCell>
                        <TableCell>
                          <SkeletonBox>
                            <div className="h-3.5 w-20" />
                          </SkeletonBox>
                        </TableCell>
                        <TableCell>
                          <SkeletonBox>
                            <div className="h-3.5 w-28" />
                          </SkeletonBox>
                        </TableCell>
                        <TableCell className="text-right">
                          <HStack gap={1} justify="end">
                            <SkeletonBox>
                              <div className="size-8 rounded-md" />
                            </SkeletonBox>
                            <SkeletonBox>
                              <div className="size-8 rounded-md" />
                            </SkeletonBox>
                          </HStack>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : rules.length > 0 ? (
                    rules.map((rule, index) => (
                      <TableRow key={index}>
                        <TableCell className="capitalize">
                          {rule.scope}
                        </TableCell>
                        <TableCell>{resolveTarget(rule)}</TableCell>
                        <TableCell>{resolveProviderName(rule)}</TableCell>
                        <TableCell>{resolveModelName(rule)}</TableCell>
                        <TableCell className="text-right">
                          <HStack gap={1} justify="end">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(index)}
                              disabled={cannotManage}
                              title={t('defaultModels.editRule', {
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
                              title={t('defaultModels.removeRule', {
                                index: index + 1,
                              })}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </HStack>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow data-no-hover>
                      <TableCell colSpan={5} className="p-0">
                        <RulesTableEmptyState
                          icon={Database}
                          title={t('defaultModels.noRulesTitle')}
                          description={t('defaultModels.noRulesDescription')}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </Stack>
        )}

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
          organizationId={organizationId}
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
      </SettingsSection>
    </Skeletonize>
  );
}
