'use client';

import {
  type StandardAgentConfig,
  standardAgentConfigSchema,
} from '@tale/shared/schemas/governance';
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { useFormEditor, useRegisterGroupedEditor } from '@tale/ui/editor';
import { Label } from '@tale/ui/label';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@tale/ui/searchable-select';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Switch } from '@tale/ui/switch';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { Link } from '@tanstack/react-router';
import { useCallback, useId, useMemo } from 'react';
import { z } from 'zod';

import {
  useProjectHarnesses,
  useStandardAgent,
} from '@/app/features/projects/hooks/queries';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility } from '@/app/hooks/use-ability';
import { BackendApiError } from '@/app/lib/backend/api-client';
import { useT } from '@/lib/i18n/client';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { useGovernancePolicyToggle } from '../hooks/use-governance-policy-toggle';
import { modelSelectionValue, parseModelSelection } from './model-id';

const FORM_ID = 'governance-standard-agent-form';
const AUTOMATIC = '__automatic__';
const INSTRUCTIONS_MAX = 20_000;

/** The sentence for each reason the standard agent cannot run. */
const REFUSAL_KEY = {
  off: 'standardAgent.refusal.switchedOff',
  unreadable: 'standardAgent.refusal.unreadable',
  'harness-invalid': 'standardAgent.refusal.harnessInvalid',
  'no-model': 'standardAgent.refusal.noModel',
  'pin-unavailable': 'standardAgent.refusal.pinUnavailable',
} as const;

const formSchema = z.object({
  harness: z.string().min(1),
  selection: z
    .string()
    .refine(
      (value) => value === AUTOMATIC || parseModelSelection(value) !== null,
    ),
  instructions: z.string().max(INSTRUCTIONS_MAX),
});
type StandardAgentForm = z.infer<typeof formSchema>;

/** Everything but the switch — kept when only the switch flips. */
function settingsOf(
  config: StandardAgentConfig | null,
): Omit<StandardAgentConfig, 'enabled'> {
  if (config === null) return {};
  const { enabled: _enabled, ...rest } = config;
  return rest;
}

// =============================================================================
// The organization's standard agent: the agent Tale provides in every
// project that has none of its own, so anyone who can open the project can
// hand it a task. On until an admin switches it off: the header switch saves
// at once and keeps the saved choices; the runtime, model and instructions
// save through the settings header's Save/Discard cluster. Under the fields,
// the server says what it runs on for the person looking — the same
// resolution a run gets when they start it — or why it cannot run.
// =============================================================================
export function StandardAgentEditor({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('governance');
  const harnessFieldId = useId();
  const modelFieldId = useId();
  const instructionsFieldId = useId();
  const ability = useAbility();
  const canEdit = ability.can('write', 'orgSettings');
  const policyQuery = useGovernancePolicy(organizationId, 'standard_agent');
  const roster = useProjectHarnesses(organizationId);
  const availability = useStandardAgent(organizationId);
  const { mutateAsync: upsertMutation } = useUpsertGovernancePolicy({
    errorToast: false,
  });

  // A malformed file is offered for repair: saving writes a valid one. A
  // file that cannot be read at all is not — nothing is known to replace.
  const policyInvalid =
    policyQuery.error instanceof BackendApiError &&
    policyQuery.error.code === 'GOVERNANCE_POLICY_INVALID';
  const readFailed = policyQuery.isError && !policyInvalid;
  // A missing file is the default: on, everything automatic.
  const saved = useMemo<StandardAgentConfig | null>(() => {
    if (policyInvalid) return { enabled: true };
    if (policyQuery.isError || policyQuery.data === undefined) return null;
    if (policyQuery.data === null) return { enabled: true };
    const parsed = standardAgentConfigSchema.safeParse(policyQuery.data.config);
    return parsed.success ? parsed.data : { enabled: true };
  }, [policyInvalid, policyQuery.data, policyQuery.isError]);

  const { enabled, isToggling, onToggle } = useGovernancePolicyToggle({
    organizationId,
    policyType: 'standard_agent',
    savedEnabled: saved?.enabled ?? true,
    isLoading: policyQuery.isLoading,
    buildConfig: (next): StandardAgentConfig => ({
      enabled: next,
      ...settingsOf(saved),
    }),
    failureTitle: t('toastSaveFailedTitle'),
    failureDescription: t('standardAgent.saveFailed'),
  });

  const data = useMemo<StandardAgentForm | undefined>(() => {
    if (policyQuery.isLoading || saved === null) return undefined;
    return {
      harness: saved.harness ?? AUTOMATIC,
      selection:
        saved.providerSlug !== undefined && saved.modelId !== undefined
          ? modelSelectionValue(saved.providerSlug, saved.modelId)
          : AUTOMATIC,
      instructions: saved.instructions ?? '',
    };
  }, [policyQuery.isLoading, saved]);

  const save = useCallback(
    async ({ harness, selection, instructions }: StandardAgentForm) => {
      if (readFailed) throw new Error(t('standardAgent.loadFailed'));
      const pin =
        selection === AUTOMATIC ? null : parseModelSelection(selection);
      const trimmed = instructions.trim();
      try {
        await upsertMutation({
          organizationId,
          policyType: 'standard_agent',
          config: standardAgentConfigSchema.parse({
            enabled,
            ...(harness !== AUTOMATIC ? { harness } : {}),
            ...pin,
            ...(trimmed !== '' ? { instructions: trimmed } : {}),
          }) satisfies StandardAgentConfig,
        });
      } catch (error) {
        throw new Error(t('standardAgent.saveFailed'), { cause: error });
      }
    },
    [enabled, organizationId, readFailed, t, upsertMutation],
  );

  const editor = useFormEditor({
    data,
    schema: formSchema,
    save,
    defaultValues: {
      harness: AUTOMATIC,
      selection: AUTOMATIC,
      instructions: '',
    },
  });
  // Read-only viewers and a switched-off agent stay unregistered, so the
  // global cluster never renders for fields nobody can see or edit.
  useRegisterGroupedEditor(editor, { enabled: canEdit && enabled });
  const harness = editor.form.watch('harness');
  const selection = editor.form.watch('selection');
  const instructions = editor.form.watch('instructions');

  const harnessOptions = useMemo<SearchableSelectOption[]>(() => {
    const rows: SearchableSelectOption[] = [
      {
        value: AUTOMATIC,
        label: t('standardAgent.automaticLabel'),
        description: t('standardAgent.automaticHarnessHint'),
      },
      ...(roster.data?.harnesses ?? []).map((entry) => ({
        value: entry.harness,
        label: entry.label,
      })),
    ];
    if (!rows.some((row) => row.value === harness)) {
      rows.push({
        value: harness,
        label: harness,
        description: t('standardAgent.savedUnavailable'),
        disabled: true,
      });
    }
    return rows;
  }, [harness, roster.data?.harnesses, t]);

  // A subscription's model runs only on the runtime it is bound to: with a
  // runtime chosen, offer what it can run.
  const modelOptions = useMemo<SearchableSelectOption[]>(() => {
    const runnable = (roster.data?.models ?? []).filter((model) => {
      const credential = model.credential;
      return (
        harness === AUTOMATIC ||
        credential.authMethod === 'api-key' ||
        credential.authMethod === 'env' ||
        credential.constraints.harness === harness
      );
    });
    const rows: SearchableSelectOption[] = [
      {
        value: AUTOMATIC,
        label: t('standardAgent.automaticLabel'),
        description: t('standardAgent.automaticModelHint'),
      },
      ...runnable.map((model) => ({
        value: modelSelectionValue(model.providerSlug, model.id),
        label: `${model.providerLabel} · ${model.label}`,
      })),
    ];
    if (!rows.some((row) => row.value === selection)) {
      const pin = parseModelSelection(selection);
      rows.push({
        value: selection,
        label: pin ? `${pin.providerSlug} · ${pin.modelId}` : selection,
        description: t('standardAgent.savedUnavailable'),
        disabled: true,
      });
    }
    return rows;
  }, [harness, roster.data?.models, selection, t]);

  // What a run would get, for the person looking — only once saved: a draft
  // is not what runs.
  const status =
    readFailed || !enabled || availability === undefined
      ? null
      : availability.available
        ? t('standardAgent.current', {
            harness: availability.harnessLabel ?? availability.harness ?? '',
            model: availability.modelLabel ?? availability.model ?? '',
          })
        : null;
  const refusal = readFailed
    ? t('standardAgent.loadFailed')
    : policyInvalid
      ? t('standardAgent.invalidPolicy')
      : !enabled || availability === undefined || availability.available
        ? null
        : t(REFUSAL_KEY[availability.refusal ?? 'no-model']);
  const fieldsDisabled =
    !canEdit || editor.isLoading || editor.isSaving || readFailed;

  return (
    <Skeletonize
      loading={policyQuery.isLoading}
      label={t('standardAgent.title')}
    >
      <SettingsSection
        title={t('standardAgent.title')}
        description={t('standardAgent.description')}
        action={
          <Switch
            aria-label={t('standardAgent.enabledLabel')}
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={!canEdit || isToggling || editor.isSaving || readFailed}
          />
        }
      >
        <form id={FORM_ID} onSubmit={editor.submit}>
          {enabled ? (
            <SettingsFieldList>
              <SettingsFieldRow
                label={
                  <Label htmlFor={harnessFieldId}>
                    {t('standardAgent.harnessLabel')}
                  </Label>
                }
                description={t('standardAgent.harnessHint')}
              >
                <SearchableSelect
                  id={harnessFieldId}
                  aria-label={t('standardAgent.harnessLabel')}
                  value={harness}
                  disabled={fieldsDisabled}
                  options={harnessOptions}
                  onValueChange={(value) => {
                    editor.form.setValue('harness', value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                    // A model the new runtime cannot run is no choice.
                    const pinned = (roster.data?.models ?? []).find(
                      (model) =>
                        modelSelectionValue(model.providerSlug, model.id) ===
                        selection,
                    );
                    if (
                      pinned !== undefined &&
                      value !== AUTOMATIC &&
                      pinned.credential.authMethod !== 'api-key' &&
                      pinned.credential.authMethod !== 'env' &&
                      pinned.credential.constraints.harness !== value
                    ) {
                      editor.form.setValue('selection', AUTOMATIC, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }
                  }}
                  searchPlaceholder={t('standardAgent.searchHarnesses')}
                  emptyText={t('standardAgent.noHarnessesFound')}
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                label={
                  <Label htmlFor={modelFieldId}>
                    {t('standardAgent.modelLabel')}
                  </Label>
                }
                description={t('standardAgent.modelHint')}
              >
                <SearchableSelect
                  id={modelFieldId}
                  aria-label={t('standardAgent.modelLabel')}
                  value={selection}
                  disabled={fieldsDisabled}
                  options={modelOptions}
                  onValueChange={(value) =>
                    editor.form.setValue('selection', value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  searchPlaceholder={t('standardAgent.searchModels')}
                  emptyText={t('standardAgent.noModelsFound')}
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                label={
                  <Label htmlFor={instructionsFieldId}>
                    {t('standardAgent.instructionsLabel')}
                  </Label>
                }
                description={t('standardAgent.instructionsHint')}
              >
                <Textarea
                  id={instructionsFieldId}
                  value={instructions}
                  disabled={fieldsDisabled}
                  maxLength={INSTRUCTIONS_MAX}
                  rows={4}
                  placeholder={t('standardAgent.instructionsPlaceholder')}
                  onChange={(event) =>
                    editor.form.setValue('instructions', event.target.value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                />
              </SettingsFieldRow>
              {(status || editor.isDirty) && (
                <div className="flex flex-col gap-1 pt-1">
                  {status && (
                    <Text as="p" variant="muted" className="text-xs">
                      {status}
                    </Text>
                  )}
                  {editor.isDirty && (
                    <Text as="p" variant="muted" className="text-xs">
                      {t('standardAgent.draftHint')}
                    </Text>
                  )}
                </div>
              )}
            </SettingsFieldList>
          ) : (
            !readFailed && (
              <Text as="p" variant="muted" className="text-sm">
                {t('standardAgent.offNote')}
              </Text>
            )
          )}
          {refusal && (
            <Alert variant="warning" description={refusal}>
              <div className="flex flex-wrap items-center gap-3 pt-2 text-sm">
                {ability.can('read', 'developerSettings') && (
                  <Link
                    to="/dashboard/$id/settings/providers"
                    params={{ id: organizationId }}
                    className="underline underline-offset-2"
                  >
                    {t('standardAgent.providersLink')}
                  </Link>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={policyQuery.isFetching}
                  onClick={() => void policyQuery.refetch()}
                >
                  {t('standardAgent.retry')}
                </Button>
              </div>
            </Alert>
          )}
          {editor.hasRemoteUpdate && (
            <Alert
              variant="info"
              description={t('standardAgent.remoteUpdate')}
            />
          )}
        </form>
      </SettingsSection>
    </Skeletonize>
  );
}
