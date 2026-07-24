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
import { Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  featureFlagsConfigSchema,
  MIN_MAX_CONTEXT_TOKENS,
  type FeatureFlagsConfig,
  type FeatureFlagRule,
} from '@/lib/shared/schemas/governance';
import { formatNumber } from '@/lib/utils/format/number';
import { structuralEqual } from '@/lib/utils/structural-equal';
import { isRecord } from '@/lib/utils/type-utils';

import { mapGovernanceSaveError } from '../governance-save-errors';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { useGovernancePolicyToggle } from '../hooks/use-governance-policy-toggle';
import { RulesTableEmptyState } from './rules-table-empty-state';

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

interface FeatureFlagRuleErrors {
  maxContextTokens?: string;
}

/**
 * Client-side mirror of the server floor (#2660): a sub-{@link
 * MIN_MAX_CONTEXT_TOKENS} value used to save optimistically (the row
 * appeared saved), then fail server-side with an uncaught `ConvexError` and
 * silently never persist. Blocking it here means the dialog never calls
 * `onSave` with a rule the server would reject.
 */
function validateFeatureFlagRule(
  rule: FeatureFlagRule,
  t: TFunction,
): FeatureFlagRuleErrors {
  const errors: FeatureFlagRuleErrors = {};
  if (
    rule.maxContextTokens != null &&
    rule.maxContextTokens < MIN_MAX_CONTEXT_TOKENS
  ) {
    errors.maxContextTokens = t('featureFlags.invalidMaxContextTokens', {
      min: formatNumber(MIN_MAX_CONTEXT_TOKENS),
    });
  }
  return errors;
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

  const isDirty = useMemo(
    () => !structuralEqual(draft, initialRule),
    [draft, initialRule],
  );

  const errors = useMemo(() => validateFeatureFlagRule(draft, t), [draft, t]);
  const isValid = Object.keys(errors).length === 0;

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
      // Guard: never persist a rule the server would reject (#2660). The
      // Confirm button is already disabled via `isValid` below; this is the
      // defense-in-depth backstop (e.g. Enter-to-submit inside a field).
      if (Object.keys(validateFeatureFlagRule(draft, t)).length > 0) {
        return;
      }
      onSave(draft);
      onOpenChange(false);
    },
    [draft, t, onSave, onOpenChange],
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      onSubmit={handleSubmit}
      submitText={tCommon('actions.confirm')}
      isDirty={isDirty}
      isValid={isValid}
    >
      <Stack gap={4}>
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
        />

        {draft.scope === 'role' && (
          <Select
            label={t('featureFlags.role')}
            options={roleOptions}
            value={draft.scopeId ?? ''}
            onValueChange={(value) => updateDraft({ scopeId: value })}
            disabled={cannotManage}
          />
        )}

        {draft.scope === 'user' && (
          <SearchableSelect
            label={t('featureFlags.scopeLabels.user')}
            placeholder={t('featureFlags.selectUser')}
            disabled={cannotManage}
            value={draft.scopeId ?? null}
            onValueChange={(value) => updateDraft({ scopeId: value })}
            options={memberOptions}
            searchPlaceholder={t('featureFlags.searchUsers')}
            emptyText={t('featureFlags.noUsersFound')}
            aria-label={t('featureFlags.selectUser')}
          />
        )}

        {draft.scope === 'team' && (
          <SearchableSelect
            label={t('featureFlags.scopeLabels.team')}
            placeholder={t('featureFlags.selectTeam')}
            disabled={cannotManage}
            value={draft.scopeId ?? null}
            onValueChange={(value) => updateDraft({ scopeId: value })}
            options={teamOptions}
            searchPlaceholder={t('featureFlags.searchTeams')}
            emptyText={t('featureFlags.noTeamsFound')}
            aria-label={t('featureFlags.selectTeam')}
          />
        )}

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
              placeholder="e.g. 50000"
              min={MIN_MAX_CONTEXT_TOKENS}
              errorMessage={errors.maxContextTokens}
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

/** Placeholder rows shown while the table data loads (see the View). */
const PLACEHOLDER_ROW_COUNT = 3;
/** Column count — single source for the empty-state `colSpan` and the
 *  per-cell placeholder rows so they can never drift from the header. */
const COLUMN_COUNT = 7;

// =============================================================================
// Single editor — owns data fetching, rules state, dialog state, and save/toast
// wiring. Renders the REAL `SettingsSection` once, always, wrapped in
// `<Skeletonize>`. The table renders fixed PLACEHOLDER rows while loading so an
// empty `<tbody>` never reads as "no rules" during load; the real empty-state
// only shows once loaded with zero rules.
// =============================================================================
export function FeatureFlagsEditor({
  organizationId,
}: FeatureFlagsEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading: loading } = useGovernancePolicy(
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

  const [rules, setRules] = useState<FeatureFlagRule[]>([]);

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
    policyType: 'feature_flags',
    savedEnabled: savedConfig.enabled,
    isLoading: loading,
    buildConfig: (next) => ({ enabled: next, rules: savedConfig.rules }),
    failureTitle: t('toastSaveFailedTitle'),
    failureDescription: t('featureFlags.saveFailed'),
  });

  const saveConfig = useCallback(
    async (nextRules: FeatureFlagRule[]) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'feature_flags',
          // A rule edit is only reachable while the section is on.
          config: { enabled: true, rules: nextRules },
        });
        toast({
          title: t('toastSavedTitle'),
          description: t('featureFlags.saved'),
          variant: 'success',
        });
      } catch (error: unknown) {
        toast({
          title: t('toastSaveFailedTitle'),
          description: mapGovernanceSaveError(
            error,
            t,
            t('featureFlags.saveFailed'),
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
    (rule: FeatureFlagRule) => {
      let newRules: FeatureFlagRule[];
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
    (rule: FeatureFlagRule): string => {
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
        case 'default':
          return t('featureFlags.allUsers');
        default:
          return '—';
      }
    },
    [memberOptions, teamOptions, t],
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
      ? t('featureFlags.addRule')
      : t('featureFlags.editRule');

  return (
    <Skeletonize loading={loading} label={t('featureFlags.title')}>
      <SettingsSection
        title={t('featureFlags.title')}
        description={t('featureFlags.description')}
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
                {t('featureFlags.addRule')}
              </Button>
            )}
            <Switch
              aria-label={t('featureFlags.title')}
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
          <Card padding="none" className="overflow-hidden">
            <Table aria-label={t('featureFlags.title')}>
              <TableCaption className="sr-only">
                {t('featureFlags.title')}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('featureFlags.scope')}</TableHead>
                  <TableHead>{t('featureFlags.target')}</TableHead>
                  <TableHead className="text-center">
                    {t('featureFlags.webSearch')}
                  </TableHead>
                  <TableHead className="text-center">
                    {t('featureFlags.codeExecution')}
                  </TableHead>
                  <TableHead className="text-center">
                    {t('featureFlags.fileUpload')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('featureFlags.maxContextTokens')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('featureFlags.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: PLACEHOLDER_ROW_COUNT }).map((_, i) => (
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
                        <SkeletonBox fullWidth>
                          <div className="mx-auto size-4 rounded-sm" />
                        </SkeletonBox>
                      </TableCell>
                      <TableCell>
                        <SkeletonBox fullWidth>
                          <div className="mx-auto size-4 rounded-sm" />
                        </SkeletonBox>
                      </TableCell>
                      <TableCell>
                        <SkeletonBox fullWidth>
                          <div className="mx-auto size-4 rounded-sm" />
                        </SkeletonBox>
                      </TableCell>
                      <TableCell>
                        <SkeletonBox fullWidth>
                          <div className="ml-auto h-3.5 w-14" />
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
                  ))
                ) : rules.length > 0 ? (
                  rules.map((rule, index) => (
                    <TableRow key={index}>
                      <TableCell className="capitalize">{rule.scope}</TableCell>
                      <TableCell>{resolveTarget(rule)}</TableCell>
                      <TableCell className="text-center">
                        {rule.webSearch === false ? '✘' : '✔'}
                      </TableCell>
                      <TableCell className="text-center">
                        {rule.codeExecution === false ? '✘' : '✔'}
                      </TableCell>
                      <TableCell className="text-center">
                        {rule.fileUpload === false ? '✘' : '✔'}
                      </TableCell>
                      <TableCell className="text-right">
                        {rule.maxContextTokens != null
                          ? formatNumber(rule.maxContextTokens)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <HStack gap={1} justify="end">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onEditRule(index)}
                            disabled={cannotManage}
                            title={`${t('featureFlags.editRule')} ${index + 1}`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onRemoveRule(index)}
                            disabled={cannotManage}
                            title={`${t('featureFlags.deleteRule')} ${index + 1}`}
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
                        icon={SlidersHorizontal}
                        title={t('featureFlags.noRulesTitle')}
                        description={t('featureFlags.noRulesDescription')}
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
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
        />

        <ConfirmDialog
          open={deletingIndex !== null}
          onOpenChange={(open) => {
            if (!open) onDeletingIndexChange(null);
          }}
          title={t('featureFlags.removeRuleConfirmTitle')}
          description={t('featureFlags.removeRuleConfirmDescription')}
          confirmText={t('featureFlags.removeRuleConfirmAction')}
          variant="destructive"
          onConfirm={onConfirmRemove}
        />
      </SettingsSection>
    </Skeletonize>
  );
}
