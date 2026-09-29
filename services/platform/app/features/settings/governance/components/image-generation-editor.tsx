'use client';

import {
  type ImageGenerationConfig,
  imageGenerationConfigSchema,
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

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy, useImageGenerationState } from '../hooks/queries';
import { useGovernancePolicyToggle } from '../hooks/use-governance-policy-toggle';
import { modelSelectionValue, parseModelSelection } from './model-id';

const FORM_ID = 'governance-image-generation-form';
const AUTOMATIC = '__automatic__';
const INVALID = '__invalid__';
const UNKNOWN = '__unknown__';

const formSchema = z.object({
  selection: z
    .string()
    .refine(
      (value) => value === AUTOMATIC || parseModelSelection(value) !== null,
    ),
});
type ImageGenerationForm = z.infer<typeof formSchema>;

function errorMessageKey(code: string) {
  switch (code) {
    case 'NO_IMAGE_GENERATION_MODEL':
      return 'imageGeneration.noAvailable';
    case 'IMAGE_GENERATION_MODEL_UNAVAILABLE':
      return 'imageGeneration.unavailable';
    case 'IMAGE_GENERATION_POLICY_INVALID':
      return 'imageGeneration.invalidPolicy';
    case 'IMAGE_GENERATION_POLICY_UNAVAILABLE':
      return 'imageGeneration.policyUnavailable';
    default:
      return 'imageGeneration.resolutionFailed';
  }
}

/** The saved pin, carried over when only the switch flips. */
function pinOf(
  config: ImageGenerationConfig | null,
): Pick<ImageGenerationConfig, 'providerSlug' | 'modelId'> {
  return config?.providerSlug !== undefined && config.modelId !== undefined
    ? { providerSlug: config.providerSlug, modelId: config.modelId }
    : {};
}

// =============================================================================
// Whether agents may generate images, and with which model. Off until an
// admin turns it on: the header switch saves at once (and keeps the saved
// model choice), the model row appears only while it is on and saves through
// the settings header's Save/Discard cluster like the other model sections.
// The model list and the effective pick come from the server, which applies
// the exact admission a turn's `generate_image` grant applies — so the
// picker cannot offer a model the tool could not call, and a pinned model
// that stops being servable is shown as a refusal, never replaced.
// =============================================================================
export function ImageGenerationEditor({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('governance');
  const fieldId = useId();
  const ability = useAbility();
  const canEdit = ability.can('write', 'orgSettings');
  const policyQuery = useGovernancePolicy(organizationId, 'image_generation');
  const stateQuery = useImageGenerationState(organizationId);
  const errorCode = stateQuery.data?.error?.code;
  const policyInvalid = errorCode === 'IMAGE_GENERATION_POLICY_INVALID';
  const policyUnavailable = errorCode === 'IMAGE_GENERATION_POLICY_UNAVAILABLE';
  // A status answer can name a malformed policy even when the strict policy
  // read refused it — enough to offer the repair (switching or saving writes
  // a valid file), unlike a transport failure or unreadable configuration.
  const readFailed =
    stateQuery.isError || (policyQuery.isError && !policyInvalid);
  const { mutateAsync: upsertMutation } = useUpsertGovernancePolicy({
    errorToast: false,
  });

  const saved = useMemo<ImageGenerationConfig | null>(() => {
    if (policyQuery.isError || policyQuery.data === undefined) return null;
    if (policyQuery.data === null) return { enabled: false };
    const parsed = imageGenerationConfigSchema.safeParse(
      policyQuery.data.config,
    );
    return parsed.success ? parsed.data : null;
  }, [policyQuery.data, policyQuery.isError]);

  const { enabled, isToggling, onToggle } = useGovernancePolicyToggle({
    organizationId,
    policyType: 'image_generation',
    savedEnabled: saved?.enabled ?? false,
    isLoading: policyQuery.isLoading,
    buildConfig: (next): ImageGenerationConfig => ({
      enabled: next,
      ...pinOf(saved),
    }),
    failureTitle: t('toastSaveFailedTitle'),
    failureDescription: t('imageGeneration.saveFailed'),
  });

  const data = useMemo<ImageGenerationForm | undefined>(() => {
    if (policyUnavailable) return { selection: UNKNOWN };
    if (policyQuery.isLoading) return undefined;
    if (saved === null) return { selection: INVALID };
    return {
      selection:
        saved.providerSlug !== undefined && saved.modelId !== undefined
          ? modelSelectionValue(saved.providerSlug, saved.modelId)
          : AUTOMATIC,
    };
  }, [policyQuery.isLoading, policyUnavailable, saved]);

  const save = useCallback(
    async ({ selection }: ImageGenerationForm) => {
      if (readFailed || policyUnavailable) {
        throw new Error(t('imageGeneration.loadFailed'));
      }
      const pin =
        selection === AUTOMATIC ? null : parseModelSelection(selection);
      try {
        await upsertMutation({
          organizationId,
          policyType: 'image_generation',
          config: imageGenerationConfigSchema.parse({
            enabled,
            ...pin,
          }) satisfies ImageGenerationConfig,
        });
      } catch (error) {
        throw new Error(t('imageGeneration.saveFailed'), { cause: error });
      }
    },
    [enabled, organizationId, policyUnavailable, readFailed, t, upsertMutation],
  );

  const editor = useFormEditor({
    data,
    schema: formSchema,
    save,
    defaultValues: { selection: UNKNOWN },
  });
  // Read-only viewers and a switched-off policy stay unregistered, so the
  // global cluster never renders for a row nobody can see or edit. An
  // unedited invalid saved selection must not block saving the other
  // sections; only a valid edited choice can be saved.
  useRegisterGroupedEditor(
    { ...editor, isValid: !editor.isDirty || editor.isValid },
    { enabled: canEdit && enabled },
  );
  const selection = editor.form.watch('selection');

  const options = useMemo<SearchableSelectOption[]>(() => {
    const rows: SearchableSelectOption[] = [
      {
        value: AUTOMATIC,
        label: t('imageGeneration.automaticLabel'),
        description: t('imageGeneration.automaticHint'),
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
            ? t('imageGeneration.unknownSelection')
            : t('imageGeneration.invalidSelection'),
        description: t('imageGeneration.savedUnavailable'),
        disabled: true,
      });
    }
    return rows;
  }, [selection, stateQuery.data?.models, t]);

  // Model problems matter only while agents may generate images; a policy
  // that cannot be read or parsed matters either way.
  const errorText = readFailed
    ? t('imageGeneration.loadFailed')
    : policyInvalid || policyUnavailable
      ? t(errorMessageKey(errorCode ?? ''))
      : !enabled
        ? null
        : errorCode
          ? t(errorMessageKey(errorCode))
          : stateQuery.data?.pick === null
            ? t('imageGeneration.noAvailable')
            : null;
  const pick = readFailed || errorCode ? null : stateQuery.data?.pick;

  return (
    <Skeletonize
      loading={policyQuery.isLoading || stateQuery.isLoading}
      label={t('imageGeneration.title')}
    >
      <SettingsSection
        title={t('imageGeneration.title')}
        description={t('imageGeneration.description')}
        action={
          <Switch
            aria-label={t('imageGeneration.enabledLabel')}
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={
              !canEdit ||
              isToggling ||
              editor.isSaving ||
              readFailed ||
              policyUnavailable
            }
          />
        }
      >
        <form id={FORM_ID} onSubmit={editor.submit}>
          {enabled && (
            <SettingsFieldList>
              <SettingsFieldRow
                label={
                  <Label htmlFor={fieldId}>{t('imageGeneration.label')}</Label>
                }
                description={t('imageGeneration.labelHint')}
              >
                <div className="flex w-full flex-col gap-1">
                  <SearchableSelect
                    id={fieldId}
                    aria-label={t('imageGeneration.label')}
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
                    searchPlaceholder={t('imageGeneration.searchModels')}
                    emptyText={t('imageGeneration.noModelsFound')}
                  />
                  {pick && (
                    <Text
                      as="p"
                      variant="muted"
                      className="text-xs break-words"
                    >
                      {t(`imageGeneration.currentModel.${pick.source}`, {
                        model: `${pick.providerSlug} · ${pick.modelId}`,
                      })}
                    </Text>
                  )}
                  {editor.isDirty && (
                    <Text as="p" variant="muted" className="text-xs">
                      {t('imageGeneration.draftHint')}
                    </Text>
                  )}
                </div>
              </SettingsFieldRow>
            </SettingsFieldList>
          )}
          {errorText && (
            <Alert variant="warning" description={errorText}>
              <div className="flex flex-wrap items-center gap-3 pt-2 text-sm">
                {ability.can('read', 'developerSettings') && (
                  <Link
                    to="/dashboard/$id/settings/providers"
                    params={{ id: organizationId }}
                    className="underline underline-offset-2"
                  >
                    {t('imageGeneration.providersLink')}
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
                  {t('imageGeneration.retry')}
                </Button>
              </div>
            </Alert>
          )}
          {editor.hasRemoteUpdate && (
            <Alert
              variant="info"
              description={t('imageGeneration.remoteUpdate')}
            />
          )}
        </form>
      </SettingsSection>
    </Skeletonize>
  );
}
