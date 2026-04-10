'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Card } from '@/app/components/ui/layout/card';
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
        value: String(m.userId),
        label: m.displayName || m.email || String(m.userId),
        description: m.email && m.displayName ? m.email : undefined,
      })),
    [members],
  );

  const teamOptions = useMemo(
    () =>
      (teams ?? []).map((t) => ({
        value: String(t.id),
        label: t.name || String(t.id),
      })),
    [teams],
  );

  const savedConfig = useMemo(
    () => parseBudgetConfig(policy?.config),
    [policy],
  );

  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<BudgetRule[]>([]);

  useEffect(() => {
    setEnabled(savedConfig.enabled);
    setRules(savedConfig.rules);
  }, [savedConfig]);

  const hasChanges =
    enabled !== savedConfig.enabled ||
    JSON.stringify(rules) !== JSON.stringify(savedConfig.rules);

  const cannotManage = ability.cannot('write', 'orgSettings');
  const canSave = hasChanges && !upsertMutation.isPending && !cannotManage;

  const handleSave = useCallback(async () => {
    try {
      await upsertMutation.mutateAsync({
        organizationId,
        policyType: 'budgets',
        config: { enabled, rules },
      });
      toast({ title: 'Budget configuration saved' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to save';
      toast({ title: message, variant: 'destructive' });
    }
  }, [organizationId, enabled, rules, upsertMutation, toast]);

  const addRule = useCallback(() => {
    setRules((prev) => [...prev, emptyRule()]);
  }, []);

  const removeRule = useCallback((index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateRule = useCallback(
    (index: number, patch: Partial<BudgetRule>) => {
      setRules((prev) =>
        prev.map((r, i) => {
          if (i !== index) return r;
          const updated = { ...r, ...patch };
          // Clear scopeId when switching to default scope
          if (patch.scope === 'default') {
            delete updated.scopeId;
          }
          return updated;
        }),
      );
    },
    [],
  );

  if (isLoading) {
    return null;
  }

  return (
    <PageSection
      title="Budget Rules"
      description="Set token, cost, and request limits per scope and billing period."
      action={
        <Button onClick={handleSave} disabled={!canSave} size="sm">
          {upsertMutation.isPending ? 'Saving...' : 'Save'}
        </Button>
      }
    >
      <Stack gap={6} className="max-w-2xl">
        <Switch
          label="Enable budget enforcement"
          description="When enabled, usage will be checked against the rules below."
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={cannotManage}
        />

        <Stack gap={3}>
          {rules.map((rule, index) => (
            <Card key={index} className="relative">
              <Stack gap={4}>
                <HStack justify="between" align="center">
                  <Text className="text-sm font-medium">Rule {index + 1}</Text>
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

                <HStack gap={3} wrap>
                  <div className="w-40">
                    <Select
                      label="Scope"
                      options={SCOPE_OPTIONS}
                      value={rule.scope}
                      onValueChange={(value) =>
                        updateRule(index, {
                          scope: value as BudgetRule['scope'],
                        })
                      }
                      disabled={cannotManage}
                      size="sm"
                    />
                  </div>

                  {rule.scope === 'role' && (
                    <div className="w-40">
                      <Select
                        label="Role"
                        options={ROLE_OPTIONS}
                        value={rule.scopeId ?? ''}
                        onValueChange={(value) =>
                          updateRule(index, { scopeId: value })
                        }
                        disabled={cannotManage}
                        size="sm"
                      />
                    </div>
                  )}

                  {rule.scope === 'user' && (
                    <div className="w-56">
                      <Text className="mb-1 text-xs font-medium">User</Text>
                      <SearchableSelect
                        value={rule.scopeId ?? null}
                        onValueChange={(value) =>
                          updateRule(index, { scopeId: value })
                        }
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
                              className={
                                rule.scopeId ? '' : 'text-muted-foreground'
                              }
                            >
                              {rule.scopeId
                                ? (memberOptions.find(
                                    (o) => o.value === rule.scopeId,
                                  )?.label ?? rule.scopeId)
                                : 'Select user...'}
                            </span>
                          </button>
                        }
                      />
                    </div>
                  )}

                  {rule.scope === 'team' && (
                    <div className="w-56">
                      <Text className="mb-1 text-xs font-medium">Team</Text>
                      <SearchableSelect
                        value={rule.scopeId ?? null}
                        onValueChange={(value) =>
                          updateRule(index, { scopeId: value })
                        }
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
                              className={
                                rule.scopeId ? '' : 'text-muted-foreground'
                              }
                            >
                              {rule.scopeId
                                ? (teamOptions.find(
                                    (o) => o.value === rule.scopeId,
                                  )?.label ?? rule.scopeId)
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
                      value={rule.period}
                      onValueChange={(value) =>
                        updateRule(index, {
                          period: value as BudgetRule['period'],
                        })
                      }
                      disabled
                      size="sm"
                    />
                  </div>
                </HStack>

                <HStack gap={3} wrap>
                  <div className="w-44">
                    <Input
                      label="Max Tokens"
                      type="number"
                      value={rule.maxTokens ?? ''}
                      onChange={(e) =>
                        updateRule(index, {
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
                      Total input + output tokens. 1M tokens ≈ 750K words.
                    </Text>
                  </div>

                  <div className="w-44">
                    <Input
                      label="Max Cost (USD)"
                      type="number"
                      value={
                        rule.maxCostCents != null ? rule.maxCostCents / 100 : ''
                      }
                      onChange={(e) =>
                        updateRule(index, {
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
                      Hard spending cap in USD. GPT-4o ≈ $10/1M tokens.
                    </Text>
                  </div>

                  <div className="w-44">
                    <Input
                      label="Max Requests"
                      type="number"
                      value={rule.maxRequests ?? ''}
                      onChange={(e) =>
                        updateRule(index, {
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
                      Total AI requests per month. Leave empty for no limit.
                    </Text>
                  </div>
                </HStack>
              </Stack>
            </Card>
          ))}

          <Button
            variant="secondary"
            size="sm"
            onClick={addRule}
            disabled={cannotManage}
            className="self-start"
          >
            <Plus className="mr-1.5 size-4" />
            Add Rule
          </Button>

          {rules.length === 0 && (
            <Text variant="muted" className="text-sm">
              No budget rules configured. Add a rule to start enforcing limits.
            </Text>
          )}
        </Stack>
      </Stack>
    </PageSection>
  );
}
