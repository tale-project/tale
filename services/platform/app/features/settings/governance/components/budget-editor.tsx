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
  budgetConfigSchema,
  type BudgetConfig,
  type BudgetRule,
} from '@/lib/shared/schemas/governance';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { SelectTriggerButton } from './select-trigger-button';

interface BudgetEditorProps {
  organizationId: string;
}

const SCOPE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'user', label: 'User' },
  { value: 'team', label: 'Team' },
  { value: 'role', label: 'Role' },
  { value: 'org', label: 'Organization' },
];

function isScopeValue(v: string): v is BudgetRule['scope'] {
  return SCOPE_OPTIONS.some((o) => o.value === v);
}

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'developer', label: 'Developer' },
  { value: 'editor', label: 'Editor' },
  { value: 'member', label: 'Member' },
];

const PERIOD_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily' },
];

function isPeriodValue(v: string): v is BudgetRule['period'] {
  return PERIOD_OPTIONS.some((o) => o.value === v);
}

function emptyRule(): BudgetRule {
  return {
    scope: 'default',
    period: 'monthly',
  };
}

function parseBudgetConfig(policy: unknown): BudgetConfig {
  const config = isRecord(policy) ? policy : {};
  const result = budgetConfigSchema.safeParse(config);
  if (result.success) {
    return result.data;
  }
  return { enabled: false, rules: [] };
}

interface RuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: BudgetRule;
  onSave: (rule: BudgetRule) => void;
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

  const updateDraft = useCallback((patch: Partial<BudgetRule>) => {
    setDraft((prev) => {
      const updated = { ...prev, ...patch };
      if (patch.scope === 'default' || patch.scope === 'org') {
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
      submitText={t('budgets.confirm')}
    >
      <Stack gap={4}>
        <HStack gap={3} wrap>
          <div className="w-40">
            <Select
              label={t('budgets.scope')}
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
                label={t('budgets.role')}
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
                {t('budgets.user')}
              </Text>
              <SearchableSelect
                value={draft.scopeId ?? null}
                onValueChange={(value) => updateDraft({ scopeId: value })}
                options={memberOptions}
                searchPlaceholder={t('budgets.searchUsers')}
                emptyText={t('budgets.noUsersFound')}
                aria-label={t('budgets.selectUserAriaLabel')}
                trigger={
                  <SelectTriggerButton
                    disabled={cannotManage}
                    hasValue={!!draft.scopeId}
                  >
                    {draft.scopeId
                      ? (memberOptions.find((o) => o.value === draft.scopeId)
                          ?.label ?? draft.scopeId)
                      : t('budgets.selectUser')}
                  </SelectTriggerButton>
                }
              />
            </div>
          )}

          {draft.scope === 'team' && (
            <div className="w-56">
              <Text className="mb-1 text-xs font-medium">
                {t('budgets.team')}
              </Text>
              <SearchableSelect
                value={draft.scopeId ?? null}
                onValueChange={(value) => updateDraft({ scopeId: value })}
                options={teamOptions}
                searchPlaceholder={t('budgets.searchTeams')}
                emptyText={t('budgets.noTeamsFound')}
                aria-label={t('budgets.selectTeamAriaLabel')}
                trigger={
                  <SelectTriggerButton
                    disabled={cannotManage}
                    hasValue={!!draft.scopeId}
                  >
                    {draft.scopeId
                      ? (teamOptions.find((o) => o.value === draft.scopeId)
                          ?.label ?? draft.scopeId)
                      : t('budgets.selectTeam')}
                  </SelectTriggerButton>
                }
              />
            </div>
          )}

          <div className="w-36">
            <Select
              label={t('budgets.period')}
              options={PERIOD_OPTIONS}
              value={draft.period}
              onValueChange={(value: string) => {
                if (isPeriodValue(value)) {
                  updateDraft({ period: value });
                }
              }}
              disabled={cannotManage}
              size="sm"
            />
          </div>
        </HStack>

        <Stack gap={3}>
          <div>
            <Input
              label={t('budgets.tokenLimit')}
              type="number"
              value={draft.maxTokens ?? ''}
              onChange={(e) =>
                updateDraft({
                  maxTokens: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                })
              }
              disabled={cannotManage}
              size="sm"
              placeholder="e.g. 1000000"
              min={0}
            />
            <Text className="text-muted-foreground mt-1 text-xs">
              {t('budgets.tokenLimitHelp')}
            </Text>
          </div>

          <div>
            <Input
              label={t('budgets.costLimitUsd')}
              type="number"
              value={draft.maxCostCents != null ? draft.maxCostCents / 100 : ''}
              onChange={(e) =>
                updateDraft({
                  maxCostCents: e.target.value
                    ? Math.round(Number(e.target.value) * 100)
                    : undefined,
                })
              }
              disabled={cannotManage}
              size="sm"
              placeholder="e.g. 50.00"
              min={0}
              step={0.01}
            />
            <Text className="text-muted-foreground mt-1 text-xs">
              {t('budgets.costLimitHelp')}
            </Text>
          </div>

          <div>
            <Input
              label={t('budgets.maxRequests')}
              type="number"
              value={draft.maxRequests ?? ''}
              onChange={(e) =>
                updateDraft({
                  maxRequests: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                })
              }
              disabled={cannotManage}
              size="sm"
              placeholder="e.g. 500"
              min={0}
            />
            <Text className="text-muted-foreground mt-1 text-xs">
              {t('budgets.maxRequestsHelp')}
            </Text>
          </div>

          <div>
            <Input
              label={t('budgets.warningThreshold')}
              type="number"
              value={draft.warningThresholdPercent ?? ''}
              onChange={(e) =>
                updateDraft({
                  warningThresholdPercent: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                })
              }
              disabled={cannotManage}
              size="sm"
              placeholder="e.g. 80"
              min={0}
              max={100}
            />
            <Text className="text-muted-foreground mt-1 text-xs">
              {t('budgets.warningThresholdHelp')}
            </Text>
          </div>
        </Stack>
      </Stack>
    </FormDialog>
  );
}

function formatCost(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function BudgetEditor({ organizationId }: BudgetEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'budgets',
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
    () => parseBudgetConfig(policy?.config),
    [policy],
  );

  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<BudgetRule[]>([]);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [dialogRule, setDialogRule] = useState(emptyRule());

  useEffect(() => {
    setEnabled(savedConfig.enabled);
    setRules(savedConfig.rules);
  }, [savedConfig]);

  const cannotManage = ability.cannot('write', 'orgSettings');

  const saveConfig = useCallback(
    async (configToSave: { enabled: boolean; rules: BudgetRule[] }) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'budgets',
          config: configToSave,
        });
        toast({ title: t('budgets.saved'), variant: 'success' });
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
    (rule: BudgetRule) => {
      let newRules: BudgetRule[];
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
    (rule: BudgetRule): string => {
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
        case 'org':
          return t('budgets.orgScopeTarget');
        case 'default':
          return t('budgets.allUsers');
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
      title={t('budgets.title')}
      description={t('budgets.description')}
      action={
        <Switch
          label={t('budgets.enabled')}
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
          <Text variant="muted" className="text-xs">
            {t('budgets.overrideHint')}
          </Text>

          <Stack gap={3}>
            {rules.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t('budgets.title')}</caption>
                  <thead>
                    <tr className="border-border border-b">
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-left font-medium"
                      >
                        {t('budgets.scope')}
                      </th>
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-left font-medium"
                      >
                        {t('budgets.target')}
                      </th>
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-left font-medium"
                      >
                        {t('budgets.period')}
                      </th>
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-right font-medium"
                      >
                        {t('budgets.tokenLimit')}
                      </th>
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-right font-medium"
                      >
                        {t('budgets.maxCost')}
                      </th>
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-right font-medium"
                      >
                        {t('budgets.maxRequests')}
                      </th>
                      <th
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-right font-medium"
                      >
                        {t('budgets.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule, index) => (
                      <tr key={index} className="border-border border-b">
                        <td className="px-3 py-2 capitalize">{rule.scope}</td>
                        <td className="px-3 py-2">{resolveTarget(rule)}</td>
                        <td className="px-3 py-2 capitalize">{rule.period}</td>
                        <td className="px-3 py-2 text-right">
                          {rule.maxTokens != null
                            ? rule.maxTokens.toLocaleString()
                            : '\u2014'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {rule.maxCostCents != null
                            ? formatCost(rule.maxCostCents)
                            : '\u2014'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {rule.maxRequests != null
                            ? rule.maxRequests.toLocaleString()
                            : '\u2014'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <HStack gap={1} justify="end">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(index)}
                              disabled={cannotManage}
                              aria-label={t('budgets.editRuleAriaLabel', {
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
                              aria-label={t('budgets.removeRuleAriaLabel', {
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
                {t('budgets.noRules')}
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
              {t('budgets.addRule')}
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
            ? t('budgets.addRuleDialogTitle')
            : t('budgets.editRuleDialogTitle')
        }
        cannotManage={cannotManage}
        memberOptions={memberOptions}
        teamOptions={teamOptions}
      />
    </PageSection>
  );
}
