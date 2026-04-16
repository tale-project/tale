'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { CheckboxGroup } from '@/app/components/ui/forms/checkbox-group';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useListProviders } from '@/app/features/settings/providers/hooks/queries';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  modelAccessConfigSchema,
  type ModelAccessConfig,
  type ModelAccessRule,
} from '@/lib/shared/schemas/governance';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { SelectTriggerButton } from './select-trigger-button';

interface ModelAccessEditorProps {
  organizationId: string;
}

const SCOPE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'user', label: 'User' },
  { value: 'team', label: 'Team' },
  { value: 'role', label: 'Role' },
];

function isScopeValue(v: string): v is ModelAccessRule['scope'] {
  return SCOPE_OPTIONS.some((o) => o.value === v);
}

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'developer', label: 'Developer' },
  { value: 'editor', label: 'Editor' },
  { value: 'member', label: 'Member' },
];

const MODE_OPTIONS = [
  { value: 'allowlist', label: 'Allowlist' },
  { value: 'blocklist', label: 'Blocklist' },
];

function isModeValue(v: string): v is ModelAccessConfig['mode'] {
  return MODE_OPTIONS.some((o) => o.value === v);
}

function emptyRule(): ModelAccessRule {
  return {
    scope: 'default',
    allowedModels: [],
  };
}

function parseModelAccessConfig(policy: unknown): ModelAccessConfig {
  const config = isRecord(policy) ? policy : {};
  const result = modelAccessConfigSchema.safeParse(config);
  if (result.success) {
    return result.data;
  }
  return { enabled: false, mode: 'blocklist', rules: [] };
}

interface RuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: ModelAccessRule;
  onSave: (rule: ModelAccessRule) => void;
  title: string;
  cannotManage: boolean;
  memberOptions: { value: string; label: string; description?: string }[];
  teamOptions: { value: string; label: string }[];
  allModelOptions: { value: string; label: string }[];
  mode: ModelAccessConfig['mode'];
}

function RuleDialog({
  open,
  onOpenChange,
  rule: initialRule,
  onSave,
  title,
  cannotManage,
  memberOptions,
  teamOptions,
  allModelOptions,
  mode,
}: RuleDialogProps) {
  const { t } = useT('governance');
  const [draft, setDraft] = useState(initialRule);

  useEffect(() => {
    if (open) {
      setDraft(initialRule);
    }
  }, [open, initialRule]);

  const updateDraft = useCallback((patch: Partial<ModelAccessRule>) => {
    setDraft((prev) => {
      const updated = { ...prev, ...patch };
      if (patch.scope === 'default') {
        delete updated.scopeId;
      }
      return updated;
    });
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSave(draft);
      onOpenChange(false);
    },
    [draft, onSave, onOpenChange],
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      onSubmit={handleSubmit}
      submitText={t('modelAccess.confirm')}
      className="sm:max-w-2xl"
    >
      <Stack gap={4}>
        <HStack gap={3} wrap>
          <div className="w-40">
            <Select
              label={t('modelAccess.scope')}
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
            <div className="w-40">
              <Select
                label={t('modelAccess.role')}
                options={ROLE_OPTIONS}
                value={draft.scopeId ?? ''}
                onValueChange={(value) => updateDraft({ scopeId: value })}
                disabled={cannotManage}
                size="sm"
              />
            </div>
          )}

          {draft.scope === 'user' && (
            <div className="w-56">
              <Text className="mb-1 text-xs font-medium">
                {t('modelAccess.user')}
              </Text>
              <SearchableSelect
                value={draft.scopeId ?? null}
                onValueChange={(value) => updateDraft({ scopeId: value })}
                options={memberOptions}
                searchPlaceholder={t('modelAccess.searchUsers')}
                emptyText={t('modelAccess.noUsersFound')}
                aria-label={t('modelAccess.selectUser')}
                trigger={
                  <SelectTriggerButton
                    disabled={cannotManage}
                    hasValue={!!draft.scopeId}
                  >
                    {draft.scopeId
                      ? (memberOptions.find((o) => o.value === draft.scopeId)
                          ?.label ?? draft.scopeId)
                      : t('modelAccess.selectUser')}
                  </SelectTriggerButton>
                }
              />
            </div>
          )}

          {draft.scope === 'team' && (
            <div className="w-56">
              <Text className="mb-1 text-xs font-medium">
                {t('modelAccess.team')}
              </Text>
              <SearchableSelect
                value={draft.scopeId ?? null}
                onValueChange={(value) => updateDraft({ scopeId: value })}
                options={teamOptions}
                searchPlaceholder={t('modelAccess.searchTeams')}
                emptyText={t('modelAccess.noTeamsFound')}
                aria-label={t('modelAccess.selectTeam')}
                trigger={
                  <SelectTriggerButton
                    disabled={cannotManage}
                    hasValue={!!draft.scopeId}
                  >
                    {draft.scopeId
                      ? (teamOptions.find((o) => o.value === draft.scopeId)
                          ?.label ?? draft.scopeId)
                      : t('modelAccess.selectTeam')}
                  </SelectTriggerButton>
                }
              />
            </div>
          )}
        </HStack>

        <CheckboxGroup
          label={
            mode === 'allowlist'
              ? t('modelAccess.allowedModels')
              : t('modelAccess.blockedModels')
          }
          options={allModelOptions}
          value={
            mode === 'allowlist'
              ? draft.allowedModels
              : (draft.blockedModels ?? [])
          }
          onValueChange={(values) => {
            if (mode === 'allowlist') {
              updateDraft({ allowedModels: values });
            } else {
              updateDraft({ blockedModels: values });
            }
          }}
          disabled={cannotManage}
          columns={2}
        />
      </Stack>
    </FormDialog>
  );
}

export function ModelAccessEditor({ organizationId }: ModelAccessEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'model_access',
  );
  const upsertMutation = useUpsertGovernancePolicy();
  const { members } = useMembers(organizationId);
  const { teams } = useOrgTeams();
  const { providers } = useListProviders('default');

  const memberOptions = useMemo(
    () =>
      (members ?? []).map((m) => ({
        value: m.userId,
        label: m.displayName || m.email || m.userId,
        description: m.email && m.displayName ? m.email : undefined,
      })),
    [members],
  );

  const teamOptions = useMemo(
    () =>
      (teams ?? []).map((team) => ({
        value: team.id,
        label: team.name || team.id,
      })),
    [teams],
  );

  const allModelOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    for (const provider of providers) {
      if (
        !provider ||
        !('models' in provider) ||
        !Array.isArray(provider.models)
      )
        continue;
      for (const model of provider.models) {
        options.push({
          value: model.id,
          label: model.displayName || model.id,
        });
      }
    }
    return options;
  }, [providers]);

  const savedConfig = useMemo(
    () => parseModelAccessConfig(policy?.config),
    [policy],
  );

  const [hydrated, setHydrated] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<ModelAccessConfig['mode']>('blocklist');
  const [rules, setRules] = useState<ModelAccessRule[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [dialogRule, setDialogRule] = useState(emptyRule());

  useEffect(() => {
    setEnabled(savedConfig.enabled);
    setMode(savedConfig.mode);
    setRules(savedConfig.rules);
    setHydrated(true);
  }, [savedConfig]);

  const cannotManage = ability.cannot('write', 'orgSettings');

  const saveConfig = useCallback(
    async (configToSave: ModelAccessConfig) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'model_access',
          config: configToSave,
        });
        toast({ title: t('modelAccess.saved'), variant: 'success' });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : t('modelAccess.saveFailed');
        toast({ title: message, variant: 'destructive' });
      }
    },
    [organizationId, upsertMutation, toast, t],
  );

  const handleToggleEnabled = useCallback(
    (checked: boolean) => {
      setEnabled(checked);
      void saveConfig({ enabled: checked, mode, rules });
    },
    [saveConfig, mode, rules],
  );

  const handleModeChange = useCallback(
    (value: string) => {
      if (!isModeValue(value)) return;
      setMode(value);
      void saveConfig({ enabled, mode: value, rules });
    },
    [saveConfig, enabled, rules],
  );

  const removeRule = useCallback(
    (index: number) => {
      const newRules = rules.filter((_, i) => i !== index);
      setRules(newRules);
      void saveConfig({ enabled, mode, rules: newRules });
    },
    [rules, enabled, mode, saveConfig],
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
    (rule: ModelAccessRule) => {
      let newRules: ModelAccessRule[];
      if (editingIndex === null) {
        newRules = [...rules, rule];
      } else {
        newRules = rules.map((r, i) => (i === editingIndex ? rule : r));
      }
      setRules(newRules);
      void saveConfig({ enabled, mode, rules: newRules });
    },
    [editingIndex, rules, enabled, mode, saveConfig],
  );

  const resolveTarget = useCallback(
    (rule: ModelAccessRule): string => {
      switch (rule.scope) {
        case 'user': {
          if (!rule.scopeId) return '\u2014';
          return (
            memberOptions.find((o) => o.value === rule.scopeId)?.label ??
            rule.scopeId
          );
        }
        case 'team': {
          if (!rule.scopeId) return '\u2014';
          return (
            teamOptions.find((o) => o.value === rule.scopeId)?.label ??
            rule.scopeId
          );
        }
        case 'role':
          return rule.scopeId ?? '\u2014';
        case 'default':
          return t('modelAccess.allUsers');
        default:
          return '\u2014';
      }
    },
    [memberOptions, teamOptions, t],
  );

  const resolveModelNames = useCallback(
    (modelIds: string[]): string => {
      if (modelIds.length === 0) return '\u2014';
      const names = modelIds.map((id) => {
        const opt = allModelOptions.find((o) => o.value === id);
        return opt?.label ?? id;
      });
      if (names.length <= 3) return names.join(', ');
      return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
    },
    [allModelOptions],
  );

  if (isLoading || !hydrated) {
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
      title={t('modelAccess.title')}
      description={t('modelAccess.description')}
      action={
        <Switch
          label={t('modelAccess.enabled')}
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
          <HStack gap={2} align="center">
            <Text className="text-sm font-medium">{t('modelAccess.mode')}</Text>
            <div className="w-36">
              <Select
                options={MODE_OPTIONS}
                value={mode}
                onValueChange={handleModeChange}
                disabled={cannotManage || upsertMutation.isPending}
                size="sm"
              />
            </div>
          </HStack>
          <Stack gap={3}>
            {rules.length > 0 ? (
              <div className="overflow-x-auto">
                <table
                  className="w-full text-sm"
                  aria-label={t('modelAccess.title')}
                >
                  <caption className="sr-only">
                    {t('modelAccess.title')}
                  </caption>
                  <thead>
                    <tr className="border-border border-b">
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-left font-medium"
                      >
                        {t('modelAccess.scope')}
                      </th>
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-left font-medium"
                      >
                        {t('modelAccess.target')}
                      </th>
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-left font-medium"
                      >
                        {mode === 'allowlist'
                          ? t('modelAccess.allowedModels')
                          : t('modelAccess.blockedModels')}
                      </th>
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-right font-medium"
                      >
                        {t('modelAccess.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule, index) => (
                      <tr key={index} className="border-border border-b">
                        <td className="px-3 py-2 capitalize">{rule.scope}</td>
                        <td className="px-3 py-2">{resolveTarget(rule)}</td>
                        <td className="px-3 py-2">
                          {mode === 'allowlist'
                            ? resolveModelNames(rule.allowedModels)
                            : resolveModelNames(rule.blockedModels ?? [])}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <HStack gap={1} justify="end">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(index)}
                              disabled={cannotManage}
                              aria-label={t('modelAccess.editRule')}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeRule(index)}
                              disabled={cannotManage}
                              aria-label={t('modelAccess.deleteRule')}
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
                {t('modelAccess.noRules')}
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
              {t('modelAccess.addRule')}
            </Button>
          </Stack>
        </Stack>
      </div>

      {dialogOpen && (
        <RuleDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          rule={dialogRule}
          onSave={handleDialogSave}
          title={
            editingIndex === null
              ? t('modelAccess.addRule')
              : t('modelAccess.editRule')
          }
          cannotManage={cannotManage}
          memberOptions={memberOptions}
          teamOptions={teamOptions}
          allModelOptions={allModelOptions}
          mode={mode}
        />
      )}
    </PageSection>
  );
}
