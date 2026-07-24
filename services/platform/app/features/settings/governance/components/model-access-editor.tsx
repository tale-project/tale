'use client';

import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { HStack, Stack } from '@tale/ui/layout';
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
import { Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { MultiSelect } from '@/app/components/ui/forms/multi-select';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import {
  type ModelInfoCapabilities,
  ModelInfoPopover,
} from '@/app/features/shared/models/model-info-popover';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  defaultModelsConfigSchema,
  modelAccessConfigSchema,
  type DefaultModelRule,
  type DefaultModelsConfig,
  type ModelAccessConfig,
  type ModelAccessRule,
} from '@/lib/shared/schemas/governance';
import { isRecord } from '@/lib/utils/type-utils';

import { mapGovernanceSaveError } from '../governance-save-errors';
import { useListProviders, useModelCapabilities } from '../hooks/model-catalog';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { stripQualifier } from './model-id';
import { ROLE_OPTIONS } from './role-options';
import { RulesTableEmptyState } from './rules-table-empty-state';

function parseDefaultModelsConfig(policy: unknown): DefaultModelsConfig | null {
  const config = isRecord(policy) ? policy : null;
  if (!config) return null;
  const result = defaultModelsConfigSchema.safeParse(config);
  return result.success ? result.data : null;
}

/**
 * Given a proposed model_access configuration, return the default-model rules
 * whose modelId would be denied. Mirrors backend `checkModelAccess` priority:
 * team > role > default (default_models has no user scope).
 */
function findDefaultRulesDeniedBy(
  nextAccess: ModelAccessConfig,
  defaultRules: DefaultModelRule[],
): DefaultModelRule[] {
  if (!nextAccess.enabled || nextAccess.rules.length === 0) return [];

  const denied: DefaultModelRule[] = [];
  for (const d of defaultRules) {
    let matched: ModelAccessRule | undefined;
    if (d.scope === 'team' && d.scopeId) {
      matched = nextAccess.rules.find(
        (r) => r.scope === 'team' && r.scopeId === d.scopeId,
      );
    }
    if (!matched && d.scope === 'role' && d.scopeId) {
      matched = nextAccess.rules.find(
        (r) => r.scope === 'role' && r.scopeId === d.scopeId,
      );
    }
    if (!matched) {
      matched = nextAccess.rules.find((r) => r.scope === 'default');
    }
    if (!matched) continue;

    const target = stripQualifier(d.modelId);
    const blocked = (matched.blockedModels ?? []).map(stripQualifier);
    const allowed = matched.allowedModels.map(stripQualifier);
    if (blocked.includes(target)) {
      denied.push(d);
      continue;
    }
    if (nextAccess.mode === 'allowlist' && !allowed.includes(target)) {
      denied.push(d);
    }
  }
  return denied;
}

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
  allModelOptions: { value: string; label: string; tags: string[] }[];
  modelCapabilities: Map<string, ModelInfoCapabilities>;
  organizationId: string;
  mode: ModelAccessConfig['mode'];
}

const PLACEHOLDER_ROW_COUNT = 3;

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
  modelCapabilities,
  organizationId,
  mode,
}: RuleDialogProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  const [draft, setDraft] = useState(initialRule);

  useEffect(() => {
    if (open) {
      setDraft(initialRule);
    }
  }, [open, initialRule]);

  const modelSelectOptions = useMemo(
    () => allModelOptions.map((o) => ({ value: o.value, label: o.label })),
    [allModelOptions],
  );
  const tagsByModel = useMemo(
    () => new Map(allModelOptions.map((o) => [o.value, o.tags])),
    [allModelOptions],
  );

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
    >
      <Stack gap={4}>
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
        />

        {draft.scope === 'role' && (
          <Select
            label={t('modelAccess.role')}
            options={ROLE_OPTIONS}
            value={draft.scopeId ?? ''}
            onValueChange={(value) => updateDraft({ scopeId: value })}
            disabled={cannotManage}
          />
        )}

        {draft.scope === 'user' && (
          <SearchableSelect
            label={t('modelAccess.user')}
            placeholder={t('modelAccess.selectUser')}
            disabled={cannotManage}
            value={draft.scopeId ?? null}
            onValueChange={(value) => updateDraft({ scopeId: value })}
            options={memberOptions}
            searchPlaceholder={t('modelAccess.searchUsers')}
            emptyText={t('modelAccess.noUsersFound')}
            aria-label={t('modelAccess.selectUser')}
          />
        )}

        {draft.scope === 'team' && (
          <SearchableSelect
            label={t('modelAccess.team')}
            placeholder={t('modelAccess.selectTeam')}
            disabled={cannotManage}
            value={draft.scopeId ?? null}
            onValueChange={(value) => updateDraft({ scopeId: value })}
            options={teamOptions}
            searchPlaceholder={t('modelAccess.searchTeams')}
            emptyText={t('modelAccess.noTeamsFound')}
            aria-label={t('modelAccess.selectTeam')}
          />
        )}

        <MultiSelect
          label={
            mode === 'allowlist'
              ? t('modelAccess.allowedModels')
              : t('modelAccess.blockedModels')
          }
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
          options={modelSelectOptions}
          optionAction={(option) => (
            <ModelInfoPopover
              tags={tagsByModel.get(option.value) ?? []}
              capabilities={modelCapabilities.get(option.value)}
              organizationId={organizationId}
            />
          )}
          placeholder={t('modelAccess.selectModels')}
          searchPlaceholder={tCommon('search.placeholder')}
          emptyText={tCommon('search.noResults')}
          disabled={cannotManage}
          modal
        />
      </Stack>
    </FormDialog>
  );
}

// =============================================================================
// Single editor — owns data fetching, local enabled/mode/rule/dialog state,
// save/toast wiring (including the affected-defaults confirm), and the loading
// state. Renders the REAL header (enable Switch), mode select, rules table, and
// dialogs once, always, wrapped in `<Skeletonize>`. The skeleton-aware
// `Switch`/`Select`/action `Button` mask themselves; the body (mode + table) is
// forced visible while loading so its placeholder rows can render even though
// `enabled` is still its initial `false`.
// =============================================================================
export function ModelAccessEditor({ organizationId }: ModelAccessEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'model_access',
  );
  const { data: defaultPolicy } = useGovernancePolicy(
    organizationId,
    'default_models',
  );
  const defaultRules = useMemo<DefaultModelRule[]>(() => {
    const parsed = parseDefaultModelsConfig(defaultPolicy?.config);
    return parsed?.enabled ? parsed.rules : [];
  }, [defaultPolicy]);
  const upsertMutation = useUpsertGovernancePolicy();
  const { members } = useMembers(organizationId);
  const { teams } = useOrgTeams();
  const { providers } = useListProviders(organizationId);

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
    const options: { value: string; label: string; tags: string[] }[] = [];
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
          tags: model.tags ?? [],
        });
      }
    }
    return options;
  }, [providers]);

  const savedConfig = useMemo(
    () => parseModelAccessConfig(policy?.config),
    [policy],
  );

  const initializedRef = useRef(false);
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<ModelAccessConfig['mode']>('blocklist');
  const [rules, setRules] = useState<ModelAccessRule[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [dialogRule, setDialogRule] = useState(emptyRule());
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  // Capabilities power the per-model info popover inside the rule dialog only,
  // so don't subscribe (a per-model indexed read fan-out) until it's open.
  const modelCapabilities = useModelCapabilities(
    organizationId,
    useMemo(
      () => (dialogOpen ? allModelOptions.map((o) => o.value) : []),
      [dialogOpen, allModelOptions],
    ),
  );

  // Pending save + affected-defaults confirmation state.
  const [pendingSave, setPendingSave] = useState<{
    next: ModelAccessConfig;
    affected: DefaultModelRule[];
    revert: () => void;
  } | null>(null);

  if (!isLoading && !initializedRef.current) {
    initializedRef.current = true;
    setEnabled(savedConfig.enabled);
    setMode(savedConfig.mode);
    setRules(savedConfig.rules);
  }

  const cannotManage = ability.cannot('write', 'orgSettings');

  const saveConfig = useCallback(
    async (configToSave: ModelAccessConfig) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'model_access',
          config: configToSave,
        });
        toast({
          title: t('toastSavedTitle'),
          description: t('modelAccess.saved'),
          variant: 'success',
        });
      } catch (error: unknown) {
        toast({
          title: t('toastSaveFailedTitle'),
          description: mapGovernanceSaveError(
            error,
            t,
            t('modelAccess.saveFailed'),
          ),
          variant: 'destructive',
        });
      }
    },
    [organizationId, upsertMutation, toast, t],
  );

  /**
   * Attempt to save; if the proposed config would deny any current
   * default-model rule, open a confirm dialog. `revert` restores local state
   * if the admin cancels.
   */
  const attemptSaveConfig = useCallback(
    (next: ModelAccessConfig, revert: () => void) => {
      const affected = findDefaultRulesDeniedBy(next, defaultRules);
      if (affected.length === 0) {
        void saveConfig(next);
        return;
      }
      setPendingSave({ next, affected, revert });
    },
    [defaultRules, saveConfig],
  );

  const handleToggleEnabled = useCallback(
    (checked: boolean) => {
      const prev = enabled;
      setEnabled(checked);
      attemptSaveConfig({ enabled: checked, mode, rules }, () =>
        setEnabled(prev),
      );
    },
    [attemptSaveConfig, enabled, mode, rules],
  );

  const handleModeChange = useCallback(
    (value: string) => {
      if (!isModeValue(value)) return;
      const prev = mode;
      setMode(value);
      attemptSaveConfig({ enabled, mode: value, rules }, () => setMode(prev));
    },
    [attemptSaveConfig, enabled, mode, rules],
  );

  const confirmRemoveRule = useCallback(() => {
    if (deletingIndex === null) return;
    const prev = rules;
    const newRules = rules.filter((_, i) => i !== deletingIndex);
    setRules(newRules);
    setDeletingIndex(null);
    attemptSaveConfig({ enabled, mode, rules: newRules }, () => setRules(prev));
  }, [deletingIndex, rules, enabled, mode, attemptSaveConfig]);

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
      const prev = rules;
      let newRules: ModelAccessRule[];
      if (editingIndex === null) {
        newRules = [...rules, rule];
      } else {
        newRules = rules.map((r, i) => (i === editingIndex ? rule : r));
      }
      setRules(newRules);
      attemptSaveConfig({ enabled, mode, rules: newRules }, () =>
        setRules(prev),
      );
    },
    [editingIndex, rules, enabled, mode, attemptSaveConfig],
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

  const loading = isLoading || !initializedRef.current;
  const isPending = upsertMutation.isPending;

  // While loading, render fixed placeholder rows so the table occupies the
  // same height as real content and reads as "loading", not "empty".
  const displayRows = loading
    ? Array.from({ length: PLACEHOLDER_ROW_COUNT }, (_, i) => ({
        __placeholder: i,
      }))
    : rules;

  return (
    <Skeletonize loading={loading} label={t('modelAccess.title')}>
      <SettingsSection
        // Section divider matches Preferences / Account: first block on the
        // page stays plain; later chapters get a hairline + pt-8.
        title={t('modelAccess.title')}
        description={t('modelAccess.description')}
        action={
          <Switch
            aria-label={t('modelAccess.enabled')}
            checked={enabled}
            onCheckedChange={handleToggleEnabled}
            disabled={cannotManage || isPending}
          />
        }
      >
        {(enabled || loading) && (
          <Stack gap={6}>
            <HStack gap={2} align="center" justify="between">
              <HStack gap={2} align="center">
                <Text className="text-sm font-medium">
                  {t('modelAccess.mode')}
                </Text>
                <div className="w-36">
                  <Select
                    options={MODE_OPTIONS}
                    value={mode}
                    onValueChange={handleModeChange}
                    disabled={cannotManage || isPending}
                    aria-label={t('modelAccess.mode')}
                  />
                </div>
              </HStack>
              <Button
                variant="primary"
                onClick={openAddDialog}
                disabled={cannotManage}
              >
                <Plus className="mr-1.5 size-4" />
                {t('modelAccess.addRule')}
              </Button>
            </HStack>

            <Card padding="none" className="overflow-hidden">
              <Table aria-label={t('modelAccess.title')}>
                <TableCaption className="sr-only">
                  {t('modelAccess.title')}
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('modelAccess.scope')}</TableHead>
                    <TableHead>{t('modelAccess.target')}</TableHead>
                    <TableHead>
                      {mode === 'allowlist'
                        ? t('modelAccess.allowedModels')
                        : t('modelAccess.blockedModels')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('modelAccess.actions')}
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
                            <div className="h-3.5 w-32" />
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
                        <TableCell>
                          {mode === 'allowlist'
                            ? resolveModelNames(rule.allowedModels)
                            : resolveModelNames(rule.blockedModels ?? [])}
                        </TableCell>
                        <TableCell className="text-right">
                          <HStack gap={1} justify="end">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(index)}
                              disabled={cannotManage}
                              title={t('modelAccess.editRule')}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeletingIndex(index)}
                              disabled={cannotManage}
                              title={t('modelAccess.deleteRule')}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </HStack>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow data-no-hover>
                      <TableCell colSpan={4} className="p-0">
                        <RulesTableEmptyState
                          icon={ShieldCheck}
                          title={t('modelAccess.noRulesTitle')}
                          description={t('modelAccess.noRulesDescription')}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </Stack>
        )}

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
            modelCapabilities={modelCapabilities}
            organizationId={organizationId}
            mode={mode}
          />
        )}

        <ConfirmDialog
          open={deletingIndex !== null}
          onOpenChange={(open) => {
            if (!open) setDeletingIndex(null);
          }}
          title={t('modelAccess.removeRuleConfirmTitle')}
          description={t('modelAccess.removeRuleConfirmDescription')}
          confirmText={t('modelAccess.removeRuleConfirmAction')}
          variant="destructive"
          onConfirm={confirmRemoveRule}
        />

        <ConfirmDialog
          open={pendingSave !== null}
          onOpenChange={(open) => {
            if (!open && pendingSave) {
              pendingSave.revert();
              setPendingSave(null);
            }
          }}
          title={t('modelAccess.removeDefaultConfirmTitle')}
          description={t('modelAccess.removeDefaultConfirmBody', {
            rules:
              pendingSave?.affected
                .map((r) => {
                  const target =
                    r.scope === 'default'
                      ? t('modelAccess.allUsers')
                      : (r.scopeId ?? r.scope);
                  return `${r.modelId} (${target})`;
                })
                .join(', ') ?? '',
          })}
          confirmText={t('modelAccess.removeDefaultConfirmAction')}
          variant="destructive"
          onConfirm={() => {
            if (pendingSave) {
              void saveConfig(pendingSave.next);
              setPendingSave(null);
            }
          }}
        />
      </SettingsSection>
    </Skeletonize>
  );
}
