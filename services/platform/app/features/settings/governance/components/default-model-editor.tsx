'use client';

import { AlertCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Alert } from '@/app/components/ui/feedback/alert';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
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
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { SelectTriggerButton } from './select-trigger-button';

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
              <Text className="mb-1 text-xs font-medium">
                {t('defaultModels.target')}
              </Text>
              <SearchableSelect
                value={draft.scopeId ?? null}
                onValueChange={(value) => updateDraft({ scopeId: value })}
                options={teamOptions}
                searchPlaceholder={t('defaultModels.searchTeams')}
                emptyText={t('defaultModels.noTeamsFound')}
                aria-label={t('defaultModels.target')}
                trigger={
                  <SelectTriggerButton
                    disabled={cannotManage}
                    hasValue={!!draft.scopeId}
                  >
                    {draft.scopeId
                      ? (teamOptions.find((o) => o.value === draft.scopeId)
                          ?.label ?? draft.scopeId)
                      : t('defaultModels.selectTeam')}
                  </SelectTriggerButton>
                }
              />
            </div>
          )}
        </HStack>

        <div>
          <Text className="mb-1 text-xs font-medium">
            {t('defaultModels.provider')}
          </Text>
          <SearchableSelect
            value={draft.providerName || null}
            onValueChange={(value) => updateDraft({ providerName: value })}
            options={providerOptions}
            searchPlaceholder={t('defaultModels.searchProviders')}
            emptyText={t('defaultModels.noProvidersFound')}
            aria-label={t('defaultModels.provider')}
            trigger={
              <SelectTriggerButton
                disabled={cannotManage}
                hasValue={!!draft.providerName}
              >
                {draft.providerName
                  ? (providerOptions.find((o) => o.value === draft.providerName)
                      ?.label ?? draft.providerName)
                  : t('defaultModels.selectProvider')}
              </SelectTriggerButton>
            }
          />
        </div>

        <div>
          <Text className="mb-1 text-xs font-medium">
            {t('defaultModels.model')}
          </Text>
          <SearchableSelect
            value={draft.modelId || null}
            onValueChange={(value) => updateDraft({ modelId: value })}
            options={modelOptions}
            searchPlaceholder={t('defaultModels.searchModels')}
            emptyText={t('defaultModels.noModelsFound')}
            aria-label={t('defaultModels.model')}
            trigger={
              <SelectTriggerButton
                disabled={cannotManage || !draft.providerName}
                hasValue={!!draft.modelId}
              >
                {draft.modelId
                  ? (modelOptions.find((o) => o.value === draft.modelId)
                      ?.label ?? draft.modelId)
                  : t('defaultModels.selectModel')}
              </SelectTriggerButton>
            }
          />
        </div>

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

export function DefaultModelEditor({
  organizationId,
}: DefaultModelEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'default_models',
  );
  const { data: accessPolicy } = useGovernancePolicy(
    organizationId,
    'model_access',
  );
  const upsertMutation = useUpsertGovernancePolicy();
  const { teams } = useOrgTeams();
  const { providers } = useListProviders('default');

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

  const savedConfig = useMemo(
    () => parseDefaultModelsConfig(policy?.config),
    [policy],
  );

  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<DefaultModelRule[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [dialogRule, setDialogRule] = useState(emptyRule());

  useEffect(() => {
    setEnabled(savedConfig.enabled);
    setRules(savedConfig.rules);
  }, [savedConfig]);

  const cannotManage = ability.cannot('write', 'orgSettings');

  const saveConfig = useCallback(
    async (configToSave: { enabled: boolean; rules: DefaultModelRule[] }) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'default_models',
          config: configToSave,
        });
        toast({ title: t('defaultModels.saved'), variant: 'success' });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Failed to save';
        toast({ title: message, variant: 'destructive' });
      }
    },
    [organizationId, upsertMutation, toast, t],
  );

  const handleToggleEnabled = useCallback(
    (checked: boolean) => {
      setEnabled(checked);
      void saveConfig({ enabled: checked, rules });
    },
    [saveConfig, rules],
  );

  const removeRule = useCallback(
    (index: number) => {
      const newRules = rules.filter((_, i) => i !== index);
      setRules(newRules);
      void saveConfig({ enabled, rules: newRules });
    },
    [rules, enabled, saveConfig],
  );

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
      void saveConfig({ enabled, rules: newRules });
    },
    [editingIndex, rules, enabled, saveConfig],
  );

  const resolveTarget = useCallback(
    (rule: DefaultModelRule): string => {
      switch (rule.scope) {
        case 'team': {
          if (!rule.scopeId) return '\u2014';
          return (
            teamOptions.find((o) => o.value === rule.scopeId)?.label ??
            rule.scopeId
          );
        }
        case 'role':
          return (
            ROLE_OPTIONS.find((o) => o.value === rule.scopeId)?.label ??
            rule.scopeId ??
            '\u2014'
          );
        case 'default':
          return t('defaultModels.allUsers');
        default:
          return '\u2014';
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

  if (isLoading) {
    return (
      <div aria-busy="true" className="space-y-3 py-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <PageSection
      title={t('defaultModels.title')}
      description={t('defaultModels.description')}
      action={
        <Switch
          label={t('defaultModels.enabled')}
          checked={enabled}
          onCheckedChange={handleToggleEnabled}
          disabled={cannotManage || upsertMutation.isPending}
        />
      }
    >
      <div
        className={cn(
          'transition-opacity duration-200',
          !enabled && 'pointer-events-none opacity-50',
        )}
      >
        <Stack gap={6}>
          <Stack gap={3}>
            {rules.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    {t('defaultModels.title')}
                  </caption>
                  <thead>
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
                    {rules.map((rule, index) => (
                      <tr key={index} className="border-border border-b">
                        <td className="px-3 py-2 capitalize">{rule.scope}</td>
                        <td className="px-3 py-2">{resolveTarget(rule)}</td>
                        <td className="px-3 py-2">
                          {resolveProviderName(rule)}
                        </td>
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
                              onClick={() => removeRule(index)}
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
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Text variant="muted" className="text-sm">
                {t('defaultModels.noRules')}
              </Text>
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={openAddDialog}
              disabled={cannotManage}
              className="self-start"
            >
              <Plus className="mr-1.5 size-4" />
              {t('defaultModels.addRule')}
            </Button>
          </Stack>
        </Stack>
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
    </PageSection>
  );
}
