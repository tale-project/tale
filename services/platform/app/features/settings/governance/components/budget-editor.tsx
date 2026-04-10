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
import {
  budgetConfigSchema,
  type BudgetConfig,
  type BudgetRule,
} from '@/lib/shared/schemas/governance';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

interface BudgetEditorProps {
  organizationId: string;
}

const SCOPE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'user', label: 'User' },
  { value: 'team', label: 'Team' },
  { value: 'role', label: 'Role' },
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
  { value: 'weekly', label: 'Weekly', disabled: true },
  { value: 'daily', label: 'Daily', disabled: true },
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
  const [draft, setDraft] = useState(initialRule);

  useEffect(() => {
    if (open) {
      setDraft(initialRule);
    }
  }, [open, initialRule]);

  const updateDraft = useCallback((patch: Partial<BudgetRule>) => {
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
              label="Scope"
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

          <div className="w-36">
            <Select
              label="Period"
              options={PERIOD_OPTIONS}
              value={draft.period}
              onValueChange={(value: string) => {
                if (isPeriodValue(value)) {
                  updateDraft({ period: value });
                }
              }}
              disabled
              size="sm"
            />
          </div>
        </HStack>

        <Stack gap={3}>
          <div>
            <Input
              label="Max Tokens"
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
              Total input + output tokens. 1M tokens ~ 750K words.
            </Text>
          </div>

          <div>
            <Input
              label="Max Cost (USD)"
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
              Hard spending cap in USD. GPT-4o ~ $10/1M tokens.
            </Text>
          </div>

          <div>
            <Input
              label="Max Requests"
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
              Total AI requests per period. Leave empty for no limit.
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
        toast({ title: 'Budget configuration saved', variant: 'success' });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Failed to save';
        toast({ title: message, variant: 'destructive' });
      }
    },
    [organizationId, upsertMutation, toast],
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
        case 'default':
          return 'All users';
        default:
          return '\u2014';
      }
    },
    [memberOptions, teamOptions],
  );

  if (isLoading) {
    return null;
  }

  return (
    <PageSection
      title="Budget Rules"
      description="Set token, cost, and request limits per scope and billing period."
      action={
        <Switch
          label="Enabled"
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
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border border-b">
                    <th className="text-muted-foreground px-3 py-2 text-left font-medium">
                      Scope
                    </th>
                    <th className="text-muted-foreground px-3 py-2 text-left font-medium">
                      Target
                    </th>
                    <th className="text-muted-foreground px-3 py-2 text-left font-medium">
                      Period
                    </th>
                    <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                      Max Tokens
                    </th>
                    <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                      Max Cost
                    </th>
                    <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                      Max Requests
                    </th>
                    <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                      Actions
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
                            aria-label={`Edit rule ${index + 1}`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeRule(index)}
                            disabled={cannotManage}
                            aria-label={`Remove rule ${index + 1}`}
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
              No budget rules configured. Add a rule to start enforcing limits.
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
            Add Rule
          </Button>
        </Stack>
      </Stack>

      <RuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rule={dialogRule}
        onSave={handleDialogSave}
        title={editingIndex === null ? 'Add Budget Rule' : 'Edit Budget Rule'}
        cannotManage={cannotManage}
        memberOptions={memberOptions}
        teamOptions={teamOptions}
      />
    </PageSection>
  );
}
