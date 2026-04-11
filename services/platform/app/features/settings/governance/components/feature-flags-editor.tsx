'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
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
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

interface FeatureFlagsEditorProps {
  organizationId: string;
}

const SCOPE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'user', label: 'User' },
  { value: 'team', label: 'Team' },
  { value: 'role', label: 'Role' },
];

function isScopeValue(v: string): v is FeatureFlagRule['scope'] {
  return SCOPE_OPTIONS.some((o) => o.value === v);
}

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'developer', label: 'Developer' },
  { value: 'editor', label: 'Editor' },
  { value: 'member', label: 'Member' },
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
  const [draft, setDraft] = useState(initialRule);

  useEffect(() => {
    if (open) {
      setDraft(initialRule);
    }
  }, [open, initialRule]);

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
      submitText="Confirm"
    >
      <Stack gap={4}>
        <HStack gap={3} wrap>
          <div className="w-40">
            <Select
              label={t('featureFlags.scope')}
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
                label="Role"
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
              <Text className="mb-1 text-xs font-medium">User</Text>
              <SearchableSelect
                value={draft.scopeId ?? null}
                onValueChange={(value) => updateDraft({ scopeId: value })}
                options={memberOptions}
                searchPlaceholder="Search users..."
                emptyText="No users found"
                aria-label="Select user"
                trigger={
                  <button
                    type="button"
                    disabled={cannotManage}
                    className="border-input ring-offset-background flex h-8 w-full items-center justify-between rounded-md border bg-transparent px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span
                      className={draft.scopeId ? '' : 'text-muted-foreground'}
                    >
                      {draft.scopeId
                        ? (memberOptions.find((o) => o.value === draft.scopeId)
                            ?.label ?? draft.scopeId)
                        : 'Select user...'}
                    </span>
                  </button>
                }
              />
            </div>
          )}

          {draft.scope === 'team' && (
            <div className="w-56">
              <Text className="mb-1 text-xs font-medium">Team</Text>
              <SearchableSelect
                value={draft.scopeId ?? null}
                onValueChange={(value) => updateDraft({ scopeId: value })}
                options={teamOptions}
                searchPlaceholder="Search teams..."
                emptyText="No teams found"
                aria-label="Select team"
                trigger={
                  <button
                    type="button"
                    disabled={cannotManage}
                    className="border-input ring-offset-background flex h-8 w-full items-center justify-between rounded-md border bg-transparent px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span
                      className={draft.scopeId ? '' : 'text-muted-foreground'}
                    >
                      {draft.scopeId
                        ? (teamOptions.find((o) => o.value === draft.scopeId)
                            ?.label ?? draft.scopeId)
                        : 'Select team...'}
                    </span>
                  </button>
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
    return null;
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
      <Stack gap={6}>
        <Stack gap={3}>
          {rules.length > 0 ? (
            <div className="overflow-x-auto">
              <table
                className="w-full text-sm"
                aria-label={t('featureFlags.title')}
              >
                <caption className="sr-only">{t('featureFlags.title')}</caption>
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
                      Actions
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
                          ? rule.maxContextTokens.toLocaleString()
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
