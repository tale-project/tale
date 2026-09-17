'use client';

import {
  type TranscriptionModelConfig,
  transcriptionModelConfigSchema,
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
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { useCallback, useId, useMemo } from 'react';
import { z } from 'zod';

import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import {
  useGovernancePolicy,
  useTranscriptionModelState,
} from '../hooks/queries';
import { modelSelectionValue, parseModelSelection } from './model-id';

const AUTOMATIC = '__automatic__';
const INVALID = '__invalid__';
const UNKNOWN = '__unknown__';

const formSchema = z.object({
  selection: z
    .string()
    .refine(
      (value) =>
        value === AUTOMATIC ||
        transcriptionModelConfigSchema.safeParse(parseModelSelection(value))
          .success,
    ),
});
type TranscriptionModelForm = z.infer<typeof formSchema>;

function errorMessageKey(code: string) {
  switch (code) {
    case 'NO_TRANSCRIPTION_MODEL':
      return 'transcriptionModel.noAvailable';
    case 'TRANSCRIPTION_MODEL_UNAVAILABLE':
      return 'transcriptionModel.unavailable';
    case 'TRANSCRIPTION_MODEL_POLICY_INVALID':
      return 'transcriptionModel.invalidPolicy';
    case 'TRANSCRIPTION_MODEL_POLICY_UNAVAILABLE':
      return 'transcriptionModel.policyUnavailable';
    default:
      return 'transcriptionModel.resolutionFailed';
  }
}

/**
 * Audio candidates and effective routing come from the server. In particular,
 * a missing pinned model is a visible refusal, never an Automatic fallback.
 */
export function TranscriptionModelEditor({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('governance');
  const fieldId = useId();
  const ability = useAbility();
  const canEdit = ability.can('write', 'orgSettings');
  const policyQuery = useGovernancePolicy(
    organizationId,
    'transcription_model',
  );
  const stateQuery = useTranscriptionModelState(organizationId);
  const errorCode = stateQuery.data?.error?.code;
  const policyInvalid = errorCode === 'TRANSCRIPTION_MODEL_POLICY_INVALID';
  const policyUnavailable =
    errorCode === 'TRANSCRIPTION_MODEL_POLICY_UNAVAILABLE';
  // A successful status response can identify a malformed policy even when
  // the strict policy GET refused it. That is enough to offer an explicit
  // repair, unlike a transport failure or unreadable configuration.
  const readFailed =
    stateQuery.isError || (policyQuery.isError && !policyInvalid);
  const { mutateAsync: upsertMutation } = useUpsertGovernancePolicy({
    errorToast: false,
  });

  const data = useMemo<TranscriptionModelForm | undefined>(() => {
    if (policyUnavailable) {
      return { selection: UNKNOWN };
    }
    if (policyQuery.data === undefined || policyQuery.isError) {
      return policyInvalid ? { selection: INVALID } : undefined;
    }
    const raw = policyQuery.data === null ? {} : policyQuery.data.config;
    const parsed = transcriptionModelConfigSchema.safeParse(raw);
    // Preserve a saved pair even if validation or current availability fails.
    // A partial/invalid file gets its own row so selecting Automatic repairs it
    // explicitly instead of making the broken policy look like the default.
    if (
      isRecord(raw) &&
      typeof raw.providerSlug === 'string' &&
      typeof raw.modelId === 'string'
    ) {
      return { selection: modelSelectionValue(raw.providerSlug, raw.modelId) };
    }
    return {
      selection: parsed.success && !policyInvalid ? AUTOMATIC : INVALID,
    };
  }, [policyQuery.data, policyQuery.isError, policyInvalid, policyUnavailable]);

  const save = useCallback(
    async ({ selection }: TranscriptionModelForm) => {
      if (readFailed || policyUnavailable) {
        throw new Error(t('transcriptionModel.loadFailed'));
      }
      const config: TranscriptionModelConfig =
        selection === AUTOMATIC
          ? {}
          : transcriptionModelConfigSchema.parse(
              parseModelSelection(selection),
            );
      try {
        await upsertMutation({
          organizationId,
          policyType: 'transcription_model',
          config,
        });
      } catch (error) {
        throw new Error(t('transcriptionModel.saveFailed'), { cause: error });
      }
    },
    [organizationId, readFailed, policyUnavailable, t, upsertMutation],
  );

  const editor = useFormEditor({
    data,
    schema: formSchema,
    save,
    defaultValues: { selection: UNKNOWN },
  });
  // An invalid saved policy must not prevent saving unrelated Models sections.
  // The sentinel cannot itself be saved; only a valid edited choice can be.
  useRegisterGroupedEditor(
    { ...editor, isValid: !editor.isDirty || editor.isValid },
    { enabled: canEdit },
  );
  const selection = editor.form.watch('selection');

  const options = useMemo<SearchableSelectOption[]>(() => {
    const rows: SearchableSelectOption[] = [
      {
        value: AUTOMATIC,
        label: t('transcriptionModel.automaticLabel'),
        description: t('transcriptionModel.automaticHint'),
      },
      ...(stateQuery.data?.models ?? []).map((model) => ({
        value: modelSelectionValue(model.providerSlug, model.modelId),
        label: `${model.providerDisplayName} · ${model.modelId}`,
      })),
    ];
    if (!rows.some((row) => row.value === selection)) {
      const pin = parseModelSelection(selection);
      rows.push({
        value: selection,
        label: pin
          ? `${pin.providerSlug} · ${pin.modelId}`
          : selection === UNKNOWN
            ? t('transcriptionModel.unknownSelection')
            : t('transcriptionModel.invalidSelection'),
        description: t('transcriptionModel.savedUnavailable'),
        disabled: true,
      });
    }
    return rows;
  }, [selection, stateQuery.data?.models, t]);

  const errorText = readFailed
    ? t('transcriptionModel.loadFailed')
    : errorCode
      ? t(errorMessageKey(errorCode))
      : data?.selection === INVALID
        ? t('transcriptionModel.invalidPolicy')
        : stateQuery.data?.pick === null
          ? t('transcriptionModel.noAvailable')
          : null;
  const pick = readFailed || errorCode ? null : stateQuery.data?.pick;

  return (
    <Skeletonize
      loading={policyQuery.isLoading || stateQuery.isLoading}
      label={t('transcriptionModel.title')}
    >
      <SettingsSection
        title={t('transcriptionModel.title')}
        description={t('transcriptionModel.description')}
      >
        <form id="governance-transcription-model-form" onSubmit={editor.submit}>
          <SettingsFieldList>
            <SettingsFieldRow
              label={
                <Label htmlFor={fieldId}>{t('transcriptionModel.label')}</Label>
              }
              description={t('transcriptionModel.labelHint')}
            >
              <div className="flex w-full flex-col gap-1">
                <SearchableSelect
                  id={fieldId}
                  aria-label={t('transcriptionModel.label')}
                  value={selection}
                  disabled={
                    !canEdit ||
                    editor.isLoading ||
                    editor.isSaving ||
                    readFailed ||
                    policyUnavailable
                  }
                  options={options}
                  onValueChange={(value) =>
                    editor.form.setValue('selection', value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  searchPlaceholder={t('transcriptionModel.searchModels')}
                  emptyText={t('transcriptionModel.noModelsFound')}
                />
                {pick && (
                  <Text as="p" variant="muted" className="text-xs break-words">
                    {t('transcriptionModel.currentModel', {
                      model: `${pick.providerSlug} · ${pick.modelId}`,
                    })}
                  </Text>
                )}
                {editor.isDirty && (
                  <Text as="p" variant="muted" className="text-xs">
                    {t('transcriptionModel.draftHint')}
                  </Text>
                )}
              </div>
            </SettingsFieldRow>
          </SettingsFieldList>
          {errorText && (
            <Alert variant="warning" description={errorText}>
              <div className="flex flex-wrap items-center gap-3 pt-2 text-sm">
                {ability.can('read', 'developerSettings') && (
                  <Link
                    to="/dashboard/$id/settings/providers"
                    params={{ id: organizationId }}
                    className="underline underline-offset-2"
                  >
                    {t('transcriptionModel.providersLink')}
                  </Link>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={policyQuery.isFetching || stateQuery.isFetching}
                  onClick={() => {
                    void policyQuery.refetch();
                    void stateQuery.refetch();
                  }}
                >
                  {t('transcriptionModel.retry')}
                </Button>
              </div>
            </Alert>
          )}
          {editor.hasRemoteUpdate && (
            <Alert
              variant="info"
              description={t('transcriptionModel.remoteUpdate')}
            />
          )}
        </form>
      </SettingsSection>
    </Skeletonize>
  );
}
