'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Input } from '@/app/components/ui/forms/input';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  featureFlagsConfigSchema,
  type FeatureFlagsConfig,
  type FeatureFlagRule,
} from '@/lib/shared/schemas/governance';
import { cn } from '@/lib/utils/cn';
import { formatNumber } from '@/lib/utils/format/number';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { SelectTriggerButton } from './select-trigger-button';

interface FeatureFlagsEditorProps {
  organizationId: string;
}

const SCOPE_VALUES = ['default', 'user', 'team', 'role'] as const;

function isScopeValue(v: string): v is FeatureFlagRule['scope'] {
  return (SCOPE_VALUES as readonly string[]).includes(v);
}

const ROLE_VALUES = ['admin', 'developer', 'editor', 'member'] as const;

const CONTEXT_TOKEN_PRESETS = [
  { value: 8192, label: '8K' },
  { value: 16384, label: '16K' },
  { value: 32768, label: '32K' },
  { value: 65536, label: '64K' },
  { value: 131072, label: '128K' },
];

function emptyRule(): FeatureFlagRule {
  return {
    scope: 'default',
    webSearch: true,
    codeExecution: true,
    fileUpload: true,
  };
}

function parseFeatureFlagsConfig(policy: unknown): FeatureFlagsConfig {
  const config = isRecord(policy) ? policy : {};
  const result = featureFlagsConfigSchema.safeParse(config);
  if (result.success) {
    return result.data;
  }
  return { enabled: false, rules: [] };
}

interface RuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: FeatureFlagRule;
  onSave: (rule: FeatureFlagRule) => void;
  title: string;
  cannotManage: boolean;
  memberOptions: { value: string; label: string; description?: string }[];
  teamOptions: { value: string; label: string }[];
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
}: RuleDialogProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  const [draft, setDraft] = useState(initialRule);

  const scopeOptions = useMemo(
    () =>
      SCOPE_VALUES.map((v) => ({
        value: v,
        label: t(`featureFlags.scopeLabels.${v}`),
      })),
    [t],
  );

  const roleOptions = useMemo(
    () =>
      ROLE_VALUES.map((v) => ({
        value: v,
        label: t(`featureFlags.roleLabels.${v}`),
      })),
    [t],
  );

  useEffect(() => {
    if (open) {
      setDraft(initialRule);
    }
  }, [open, initialRule]);

  const isDirty = useMemo(() => {
    return JSON.stringify(draft) !== JSON.stringify(initialRule);
  }, [draft, initialRule]);

  const updateDraft = useCallback((patch: Partial<FeatureFlagRule>) => {
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
      submitText={tCommon('actions.confirm')}
      isDirty={isDirty}
    >
      <Stack gap={4}>
        <HStack gap={3} wrap>
          <div className="w-40">
            <Select
              label={t('featureFlags.scope')}
              options={scopeOptions}
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
                label={t('featureFlags.role')}
                options={roleOptions}
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
                {t('featureFlags.scopeLabels.user')}
              </Text>
              <SearchableSelect
                value={draft.scopeId ?? null}
                onValueChange={(value) => updateDraft({ scopeId: value })}
                options={memberOptions}
                searchPlaceholder={t('featureFlags.searchUsers')}
                emptyText={t('featureFlags.noUsersFound')}
                aria-label={t('featureFlags.selectUser')}
                trigger={
                  <SelectTriggerButton
                    disabled={cannotManage}
                    hasValue={!!draft.scopeId}
                  >
                    {draft.scopeId
                      ? (memberOptions.find((o) => o.value === draft.scopeId)
                          ?.label ?? draft.scopeId)
                      : t('featureFlags.selectUser')}
                  </SelectTriggerButton>
                }
              />
            </div>
          )}

          {draft.scope === 'team' && (
            <div className="w-56">
              <Text className="mb-1 text-xs font-medium">
                {t('featureFlags.scopeLabels.team')}
              </Text>
              <SearchableSelect
                value={draft.scopeId ?? null}
                onValueChange={(value) => updateDraft({ scopeId: value })}
                options={teamOptions}
                searchPlaceholder={t('featureFlags.searchTeams')}
                emptyText={t('featureFlags.noTeamsFound')}
                aria-label={t('featureFlags.selectTeam')}
                trigger={
                  <SelectTriggerButton
                    disabled={cannotManage}
                    hasValue={!!draft.scopeId}
                  >
                    {draft.scopeId
                      ? (teamOptions.find((o) => o.value === draft.scopeId)
                          ?.label ?? draft.scopeId)
                      : t('featureFlags.selectTeam')}
                  </SelectTriggerButton>
                }
              />
            </div>
          )}
        </HStack>

        <Stack gap={3}>
          <Switch
            label={t('featureFlags.webSearch')}
            checked={draft.webSearch ?? true}
            onCheckedChange={(checked) => updateDraft({ webSearch: checked })}
            disabled={cannotManage}
          />
          <Switch
            label={t('featureFlags.codeExecution')}
            checked={draft.codeExecution ?? true}
            onCheckedChange={(checked) =>
              updateDraft({ codeExecution: checked })
            }
            disabled={cannotManage}
          />
          <Switch
            label={t('featureFlags.fileUpload')}
            checked={draft.fileUpload ?? true}
            onCheckedChange={(checked) => updateDraft({ fileUpload: checked })}
            disabled={cannotManage}
          />

          <div>
            <Input
              label={t('featureFlags.maxContextTokens')}
              type="number"
              value={draft.maxContextTokens ?? ''}
              onChange={(e) =>
                updateDraft({
                  maxContextTokens: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                })
              }
              disabled={cannotManage}
              size="sm"
              placeholder="e.g. 50000"
              min={0}
            />
            <Text className="text-muted-foreground mt-1 text-xs">
              {t('featureFlags.maxContextTokensHint')}
            </Text>
            <HStack gap={1} className="mt-2" wrap>
              {CONTEXT_TOKEN_PRESETS.map((preset) => (
                <Button
                  key={preset.value}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    updateDraft({ maxContextTokens: preset.value })
                  }
                  disabled={cannotManage}
                  className={
                    draft.maxContextTokens === preset.value
                      ? 'border-primary'
                      : ''
                  }
                >
                  {preset.label}
                </Button>
              ))}
            </HStack>
          </div>
        </Stack>
      </Stack>
    </FormDialog>
  );
}

export function FeatureFlagsEditor({
  organizationId,
}: FeatureFlagsEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'feature_flags',
  );
  const upsertMutation = useUpsertGovernancePolicy();
  const { members } = useMembers(organizationId);
  const { teams } = useOrgTeams();

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

  const savedConfig = useMemo(
    () => parseFeatureFlagsConfig(policy?.config),
    [policy],
  );

  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<FeatureFlagRule[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [dialogRule, setDialogRule] = useState(emptyRule());

  useEffect(() => {
    setEnabled(savedConfig.enabled);
    setRules(savedConfig.rules);
  }, [savedConfig]);

  const cannotManage = ability.cannot('write', 'orgSettings');

  const saveConfig = useCallback(
    async (configToSave: { enabled: boolean; rules: FeatureFlagRule[] }) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'feature_flags',
          config: configToSave,
        });
        toast({ title: t('featureFlags.saved'), variant: 'success' });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : t('featureFlags.saveFailed');
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
    (rule: FeatureFlagRule) => {
      let newRules: FeatureFlagRule[];
      if (editingIndex === null) {
        newRules = [...rules, rule];
      } else {
        newRules = rules.map((r, i) => (i === editingIndex ? rule : r));
      }
      setRules(newRules);
      void saveConfig({ enabled, rules: newRules });
    },
    [editingIndex, rules, enabled, saveConfig],
  );

  const resolveTarget = useCallback(
    (rule: FeatureFlagRule): string => {
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
          return t('featureFlags.allUsers');
        default:
          return '\u2014';
      }
    },
    [memberOptions, teamOptions, t],
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
      title={t('featureFlags.title')}
      description={t('featureFlags.description')}
      action={
        <Switch
          label={t('featureFlags.enabled')}
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
                <table
                  className="w-full text-sm"
                  aria-label={t('featureFlags.title')}
                >
                  <caption className="sr-only">
                    {t('featureFlags.title')}
                  </caption>
                  <thead>
                    <tr className="border-border border-b">
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-left font-medium"
                      >
                        {t('featureFlags.scope')}
                      </th>
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-left font-medium"
                      >
                        {t('featureFlags.target')}
                      </th>
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-center font-medium"
                      >
                        {t('featureFlags.webSearch')}
                      </th>
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-center font-medium"
                      >
                        {t('featureFlags.codeExecution')}
                      </th>
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-center font-medium"
                      >
                        {t('featureFlags.fileUpload')}
                      </th>
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-right font-medium"
                      >
                        {t('featureFlags.maxContextTokens')}
                      </th>
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-right font-medium"
                      >
                        {t('featureFlags.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule, index) => (
                      <tr key={index} className="border-border border-b">
                        <td className="px-3 py-2 capitalize">{rule.scope}</td>
                        <td className="px-3 py-2">{resolveTarget(rule)}</td>
                        <td className="px-3 py-2 text-center">
                          {rule.webSearch === false ? '\u2718' : '\u2714'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {rule.codeExecution === false ? '\u2718' : '\u2714'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {rule.fileUpload === false ? '\u2718' : '\u2714'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {rule.maxContextTokens != null
                            ? formatNumber(rule.maxContextTokens)
                            : '\u2014'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <HStack gap={1} justify="end">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(index)}
                              disabled={cannotManage}
                              aria-label={`${t('featureFlags.editRule')} ${index + 1}`}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeRule(index)}
                              disabled={cannotManage}
                              aria-label={`${t('featureFlags.deleteRule')} ${index + 1}`}
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
                {t('featureFlags.noRules')}
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
              {t('featureFlags.addRule')}
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
            ? t('featureFlags.addRule')
            : t('featureFlags.editRule')
        }
        cannotManage={cannotManage}
        memberOptions={memberOptions}
        teamOptions={teamOptions}
      />
    </PageSection>
  );
}
