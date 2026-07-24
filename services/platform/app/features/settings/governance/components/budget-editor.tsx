'use client';

import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { HStack, Stack, Row } from '@tale/ui/layout';
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
import { Text } from '@tale/ui/text';
import type { TFunction } from 'i18next';
import { Pencil, Plus, Trash2, Wallet, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { useApiKeys } from '@/app/features/settings/api-keys/hooks/use-api-keys';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
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
import { isRecord } from '@/lib/utils/type-utils';

import { mapGovernanceSaveError } from '../governance-save-errors';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { useGovernancePolicyToggle } from '../hooks/use-governance-policy-toggle';
import { ROLE_OPTIONS } from './role-options';
import { RulesTableEmptyState } from './rules-table-empty-state';

interface BudgetEditorProps {
  organizationId: string;
}

const SCOPE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'user', label: 'User' },
  { value: 'team', label: 'Team' },
  { value: 'role', label: 'Role' },
  { value: 'apiKey', label: 'API key' },
  { value: 'org', label: 'Organization' },
];

function isScopeValue(v: string): v is BudgetRule['scope'] {
  return SCOPE_OPTIONS.some((o) => o.value === v);
}

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

/** Scopes that target a specific subject — they only enforce when their target
 *  id matches a user/team/role/API key at runtime (see `budget_enforcement.ts`).
 *  Saving one with an empty target produces a permanently dead rule. The apiKey
 *  scope targets `apiKeyId`; the others target `scopeId`. */
function scopeNeedsTarget(scope: BudgetRule['scope']): boolean {
  return (
    scope === 'user' ||
    scope === 'team' ||
    scope === 'role' ||
    scope === 'apiKey'
  );
}

/** A rule only enforces meaningfully if at least one *positive* limit is set.
 *  With every limit unset the enforcer resolves no cap and the rule is dead.
 *  A limit of `0` is worse than unset: the enforcer treats it as the strictest
 *  cap (`projectedCost >= 0` etc. is always true) and blocks every request — so
 *  a set-but-non-positive limit is rejected per-field in `validateBudgetRule`. */
function hasUsableLimit(rule: BudgetRule): boolean {
  return (
    (rule.maxTokens != null && rule.maxTokens > 0) ||
    (rule.maxCostCents != null && rule.maxCostCents > 0) ||
    (rule.maxRequests != null && rule.maxRequests > 0)
  );
}

interface BudgetRuleErrors {
  scopeId?: string;
  maxTokens?: string;
  maxCostCents?: string;
  maxRequests?: string;
  warningThresholdPercent?: string;
  /** Cross-field: no positive limit set on the rule. */
  limits?: string;
}

/**
 * Client-side validation mirroring the constraints the enforcer relies on.
 * Prevents the editor from persisting a "silently dead" rule (issue #2061):
 * a user/team/role scope with no target, or a rule with no positive limit.
 */
function validateBudgetRule(rule: BudgetRule, t: TFunction): BudgetRuleErrors {
  const errors: BudgetRuleErrors = {};

  // The apiKey scope carries its target on `apiKeyId`; every other targeted
  // scope carries it on `scopeId`. Either missing is a dead rule.
  const targetMissing =
    rule.scope === 'apiKey' ? !rule.apiKeyId : !rule.scopeId;
  if (scopeNeedsTarget(rule.scope) && targetMissing) {
    errors.scopeId = t('budgets.targetRequired');
  }

  // A *set* limit must be positive. `0` (typed directly — `"0"` is truthy so it
  // survives the `onChange` guard — or a sub-cent cost that rounds down to `0`
  // cents) is not "no limit": the enforcer reads it as the strictest possible
  // cap and blocks every request. Reject `<= 0` to mirror `hasUsableLimit`'s
  // `> 0` premise so a per-field zero can't slip past as a usable limit.
  if (rule.maxTokens != null && rule.maxTokens <= 0) {
    errors.maxTokens = t('budgets.invalidTokenLimit');
  }
  if (rule.maxCostCents != null && rule.maxCostCents <= 0) {
    errors.maxCostCents = t('budgets.invalidCostLimit');
  }
  if (rule.maxRequests != null && rule.maxRequests <= 0) {
    errors.maxRequests = t('budgets.invalidMaxRequests');
  }
  if (
    rule.warningThresholdPercent != null &&
    (rule.warningThresholdPercent < 0 || rule.warningThresholdPercent > 100)
  ) {
    errors.warningThresholdPercent = t('budgets.invalidWarningThreshold');
  }

  if (!hasUsableLimit(rule)) {
    errors.limits = t('budgets.limitRequired');
  }

  return errors;
}

function parseBudgetConfig(policy: unknown): BudgetConfig {
  const config = isRecord(policy) ? policy : {};
  const result = budgetConfigSchema.safeParse(config);
  if (result.success) {
    return result.data;
  }
  return { enabled: false, rules: [] };
}

/** Inline form-level error, styled to match the `Input` component's own error
 *  row (destructive text + leading icon, announced via `role="alert"`). Used
 *  for the cross-field messages (target / at-least-one-limit) that don't belong
 *  to a single `Input`. */
function FieldError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      aria-live="polite"
      className="text-destructive flex items-center gap-1.5 text-sm"
    >
      <XCircle className="size-4" aria-hidden="true" />
      {message}
    </p>
  );
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
  apiKeyOptions: { value: string; label: string; description?: string }[];
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
  apiKeyOptions,
}: RuleDialogProps) {
  const { t } = useT('governance');
  const [draft, setDraft] = useState(initialRule);
  // Reveal a field's error only once the user has touched it (or has attempted
  // to submit) so a freshly-opened dialog isn't pre-filled with red. Keyed by
  // field name; `limits` is the cross-field "at least one limit" group.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(initialRule);
      setTouched({});
      setSubmitAttempted(false);
    }
  }, [open, initialRule]);

  const updateDraft = useCallback((patch: Partial<BudgetRule>) => {
    setTouched((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(patch)) next[key] = true;
      // Editing any limit field flags the cross-field "at least one limit" group.
      if (
        'maxTokens' in patch ||
        'maxCostCents' in patch ||
        'maxRequests' in patch
      ) {
        next.limits = true;
      }
      return next;
    });
    setDraft((prev) => {
      const updated = { ...prev, ...patch };
      if (patch.scope === 'default' || patch.scope === 'org') {
        delete updated.scopeId;
        delete updated.apiKeyId;
      } else if (patch.scope === 'apiKey') {
        // apiKey targets `apiKeyId`; drop any stale user/team/role `scopeId`.
        delete updated.scopeId;
      } else if (patch.scope !== undefined) {
        // Switching to a scopeId-targeted scope: drop any stale `apiKeyId`.
        delete updated.apiKeyId;
      }
      return updated;
    });
  }, []);

  const errors = useMemo(() => validateBudgetRule(draft, t), [draft, t]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      // Guard: never persist a dead rule. Reveal every error and bail.
      if (Object.keys(validateBudgetRule(draft, t)).length > 0) {
        setSubmitAttempted(true);
        return;
      }
      onSave(draft);
      onOpenChange(false);
    },
    [draft, t, onSave, onOpenChange],
  );

  // A field's error is shown after it's been touched or a submit was attempted.
  // The target error also surfaces as soon as a target-requiring scope is
  // chosen, so the requirement is visible the moment it becomes relevant.
  const showTargetError =
    !!errors.scopeId && (submitAttempted || touched.scope || touched.scopeId);
  const showLimitError = !!errors.limits && (submitAttempted || touched.limits);
  const fieldError = (key: keyof BudgetRuleErrors) =>
    submitAttempted || touched[key] ? errors[key] : undefined;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      onSubmit={handleSubmit}
      submitText={t('budgets.confirm')}
    >
      <Stack gap={4}>
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
        />

        {draft.scope === 'role' && (
          <Select
            label={t('budgets.role')}
            options={ROLE_OPTIONS}
            value={draft.scopeId ?? ''}
            onValueChange={(value) => updateDraft({ scopeId: value })}
            disabled={cannotManage}
            error={showTargetError}
          />
        )}

        {draft.scope === 'user' && (
          <SearchableSelect
            label={t('budgets.user')}
            placeholder={t('budgets.selectUser')}
            disabled={cannotManage}
            value={draft.scopeId ?? null}
            onValueChange={(value) => updateDraft({ scopeId: value })}
            options={memberOptions}
            searchPlaceholder={t('budgets.searchUsers')}
            emptyText={t('budgets.noUsersFound')}
            aria-label={t('budgets.selectUserAriaLabel')}
            error={showTargetError}
          />
        )}

        {draft.scope === 'team' && (
          <SearchableSelect
            label={t('budgets.team')}
            placeholder={t('budgets.selectTeam')}
            disabled={cannotManage}
            value={draft.scopeId ?? null}
            onValueChange={(value) => updateDraft({ scopeId: value })}
            options={teamOptions}
            searchPlaceholder={t('budgets.searchTeams')}
            emptyText={t('budgets.noTeamsFound')}
            aria-label={t('budgets.selectTeamAriaLabel')}
            error={showTargetError}
          />
        )}

        {draft.scope === 'apiKey' && (
          <SearchableSelect
            label={t('budgets.apiKey')}
            placeholder={t('budgets.selectApiKey')}
            disabled={cannotManage}
            value={draft.apiKeyId ?? null}
            onValueChange={(value) => updateDraft({ apiKeyId: value })}
            options={apiKeyOptions}
            searchPlaceholder={t('budgets.searchApiKeys')}
            emptyText={t('budgets.noApiKeysFound')}
            aria-label={t('budgets.selectApiKeyAriaLabel')}
            error={showTargetError}
          />
        )}

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
        />

        {showTargetError && errors.scopeId && (
          <FieldError message={errors.scopeId} />
        )}

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
              placeholder="e.g. 1000000"
              min={0}
              errorMessage={fieldError('maxTokens')}
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
              placeholder="e.g. 50.00"
              min={0}
              step={0.01}
              errorMessage={fieldError('maxCostCents')}
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
              placeholder="e.g. 500"
              min={0}
              errorMessage={fieldError('maxRequests')}
            />
            <Text className="text-muted-foreground mt-1 text-xs">
              {t('budgets.maxRequestsHelp')}
            </Text>
          </div>

          {showLimitError && errors.limits && (
            <FieldError message={errors.limits} />
          )}

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
              placeholder="e.g. 80"
              min={0}
              max={100}
              errorMessage={fieldError('warningThresholdPercent')}
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

/** Placeholder rows shown while the table data loads (see `BudgetEditorView`). */
const PLACEHOLDER_ROW_COUNT = 3;
/** Column count — kept in one place so the empty-state `colSpan` and the
 *  per-cell placeholder rows can never drift from the real header. */
const COLUMN_COUNT = 7;

// =============================================================================
// Single editor — owns data fetching, rules state, dialog state, and
// save/toast wiring. Renders the REAL `SettingsSection` once, always, wrapped in
// `<Skeletonize>`; the table renders fixed PLACEHOLDER rows while loading so an
// empty `<tbody>` never reads as "no rules" during load.
// =============================================================================
export function BudgetEditor({ organizationId }: BudgetEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading: loading } = useGovernancePolicy(
    organizationId,
    'budgets',
  );
  const upsertMutation = useUpsertGovernancePolicy();
  const { members } = useMembers(organizationId);
  const { teams } = useOrgTeams();
  // API keys the current admin can attach a budget to (their own keys, the
  // reuse-first source). A rule stores the raw `apiKeyId`, so a key that isn't
  // in this list still shows its id in the table via the fallback below.
  const { data: apiKeys } = useApiKeys(organizationId);

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

  const apiKeyOptions = useMemo(
    () =>
      (apiKeys ?? []).map((k) => ({
        value: k.id,
        label: k.name || k.start || k.id,
        description: k.start && k.name ? k.start : undefined,
      })),
    [apiKeys],
  );

  // Memoize on the consumed value (`policy?.config`), not the `policy` wrapper.
  // A query hook that hands back a fresh wrapper object each render would
  // otherwise give `savedConfig` a new identity every render, and the
  // `[savedConfig]` effect below would `setRules` in a loop.
  const savedConfig = useMemo(
    () => parseBudgetConfig(policy?.config),
    [policy?.config],
  );

  const [rules, setRules] = useState<BudgetRule[]>([]);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [dialogRule, setDialogRule] = useState(emptyRule());
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  useEffect(() => {
    setRules(savedConfig.rules);
  }, [savedConfig]);

  const cannotManage = ability.cannot('write', 'orgSettings');

  // The section's toggle. Rules survive it being switched off, so turning the
  // feature back on restores them; enforcement short-circuits on
  // `!enabled || rules.length === 0` server-side either way.
  const { enabled, isToggling, onToggle } = useGovernancePolicyToggle({
    organizationId,
    policyType: 'budgets',
    savedEnabled: savedConfig.enabled,
    isLoading: loading,
    buildConfig: (next) => ({ enabled: next, rules: savedConfig.rules }),
    failureTitle: t('toastSaveFailedTitle'),
    failureDescription: t('budgets.saveFailed'),
  });

  const saveConfig = useCallback(
    async (nextRules: BudgetRule[]) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'budgets',
          // A rule edit is only reachable while the section is on.
          config: { enabled: true, rules: nextRules },
        });
        toast({
          title: t('toastSavedTitle'),
          description: t('budgets.saved'),
          variant: 'success',
        });
      } catch (error: unknown) {
        toast({
          title: t('toastSaveFailedTitle'),
          description: mapGovernanceSaveError(
            error,
            t,
            t('budgets.saveFailed'),
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
    (rule: BudgetRule) => {
      let newRules: BudgetRule[];
      if (editingIndex === null) {
        newRules = [...rules, rule];
      } else {
        newRules = rules.map((r, i) => (i === editingIndex ? rule : r));
      }
      setRules(newRules);
      void saveConfig(newRules);
    },
    [editingIndex, rules, saveConfig],
  );

  const resolveTarget = useCallback(
    (rule: BudgetRule): string => {
      switch (rule.scope) {
        case 'user': {
          if (!rule.scopeId) return '—';
          return (
            memberOptions.find((o) => o.value === rule.scopeId)?.label ??
            rule.scopeId
          );
        }
        case 'team': {
          if (!rule.scopeId) return '—';
          return (
            teamOptions.find((o) => o.value === rule.scopeId)?.label ??
            rule.scopeId
          );
        }
        case 'role':
          return rule.scopeId ?? '—';
        case 'apiKey': {
          if (!rule.apiKeyId) return '—';
          return (
            apiKeyOptions.find((o) => o.value === rule.apiKeyId)?.label ??
            rule.apiKeyId
          );
        }
        case 'org':
          return t('budgets.orgScopeTarget');
        case 'default':
          return t('budgets.allUsers');
        default:
          return '—';
      }
    },
    [memberOptions, teamOptions, apiKeyOptions, t],
  );

  const onAddRule = openAddDialog;
  const onEditRule = openEditDialog;
  const onRemoveRule = setDeletingIndex;
  const onDialogOpenChange = setDialogOpen;
  const onDialogSave = handleDialogSave;
  const onDeletingIndexChange = setDeletingIndex;
  const onConfirmRemove = confirmRemoveRule;
  const dialogTitle =
    editingIndex === null
      ? t('budgets.addRuleDialogTitle')
      : t('budgets.editRuleDialogTitle');

  return (
    <Skeletonize loading={loading} label={t('budgets.title')}>
      <SettingsSection
        title={t('budgets.title')}
        description={t('budgets.description')}
        action={
          <Row gap={2} align="center">
            {/* Adding a rule is only offered while the section is on — there is
                nothing to add to an inactive policy. */}
            {enabled && (
              <Button
                variant="primary"
                onClick={onAddRule}
                disabled={cannotManage}
              >
                <Plus className="mr-1.5 size-4" />
                {t('budgets.addRule')}
              </Button>
            )}
            <Switch
              aria-label={t('budgets.title')}
              checked={enabled}
              onCheckedChange={onToggle}
              disabled={cannotManage || isToggling}
            />
          </Row>
        }
      >
        {/* The rules table exists only while the section is on — a toggle hides
            its content rather than showing rules nothing enforces. It stays
            mounted (masked) while loading so the skeleton keeps the real
            shape; `enabled` is only known once the read settles. */}
        {(loading || enabled) && (
          <Stack gap={6}>
            <Text variant="muted" className="text-xs">
              {t('budgets.overrideHint')}
            </Text>

            <Card padding="none" className="overflow-hidden">
              <Table>
                <TableCaption className="sr-only">
                  {t('budgets.title')}
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('budgets.scope')}</TableHead>
                    <TableHead>{t('budgets.target')}</TableHead>
                    <TableHead>{t('budgets.period')}</TableHead>
                    <TableHead className="text-right">
                      {t('budgets.tokenLimit')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('budgets.maxCost')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('budgets.maxRequests')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('budgets.actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: PLACEHOLDER_ROW_COUNT }).map(
                      (_, i) => (
                        <TableRow key={`placeholder-${i}`}>
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
                              <div className="h-3.5 w-16" />
                            </SkeletonBox>
                          </TableCell>
                          <TableCell>
                            <SkeletonBox fullWidth>
                              <div className="ml-auto h-3.5 w-14" />
                            </SkeletonBox>
                          </TableCell>
                          <TableCell>
                            <SkeletonBox fullWidth>
                              <div className="ml-auto h-3.5 w-14" />
                            </SkeletonBox>
                          </TableCell>
                          <TableCell>
                            <SkeletonBox fullWidth>
                              <div className="ml-auto h-3.5 w-12" />
                            </SkeletonBox>
                          </TableCell>
                          <TableCell>
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
                      ),
                    )
                  ) : rules.length > 0 ? (
                    rules.map((rule, index) => (
                      <TableRow key={index}>
                        <TableCell className="capitalize">
                          {rule.scope}
                        </TableCell>
                        <TableCell>{resolveTarget(rule)}</TableCell>
                        <TableCell className="capitalize">
                          {rule.period}
                        </TableCell>
                        <TableCell className="text-right">
                          {rule.maxTokens != null
                            ? rule.maxTokens.toLocaleString()
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          {rule.maxCostCents != null
                            ? formatCost(rule.maxCostCents)
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          {rule.maxRequests != null
                            ? rule.maxRequests.toLocaleString()
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <HStack gap={1} justify="end">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onEditRule(index)}
                              disabled={cannotManage}
                              title={t('budgets.editRuleAriaLabel', {
                                index: index + 1,
                              })}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onRemoveRule(index)}
                              disabled={cannotManage}
                              title={t('budgets.removeRuleAriaLabel', {
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
                      <TableCell colSpan={COLUMN_COUNT} className="p-0">
                        <RulesTableEmptyState
                          icon={Wallet}
                          title={t('budgets.noRulesTitle')}
                          description={t('budgets.noRulesDescription')}
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
          onOpenChange={onDialogOpenChange}
          rule={dialogRule}
          onSave={onDialogSave}
          title={dialogTitle}
          cannotManage={cannotManage}
          memberOptions={memberOptions}
          teamOptions={teamOptions}
          apiKeyOptions={apiKeyOptions}
        />

        <ConfirmDialog
          open={deletingIndex !== null}
          onOpenChange={(open) => {
            if (!open) onDeletingIndexChange(null);
          }}
          title={t('budgets.removeRuleConfirmTitle')}
          description={t('budgets.removeRuleConfirmDescription')}
          confirmText={t('budgets.removeRuleConfirmAction')}
          variant="destructive"
          onConfirm={onConfirmRemove}
        />
      </SettingsSection>
    </Skeletonize>
  );
}
