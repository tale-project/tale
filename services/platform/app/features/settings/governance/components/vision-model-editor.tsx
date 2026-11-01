'use client';

import {
  type VisionModelConfig,
  visionModelConfigSchema,
} from '@tale/shared/schemas/governance';
import { useFormEditor, useRegisterGroupedEditor } from '@tale/ui/editor';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@tale/ui/searchable-select';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useProviderCatalogs } from '@/app/features/settings/providers/hooks/queries';
import {
  modelOptionsByProvider,
  pickedModelName,
  type ProvidedModel,
} from '@/app/features/shared/models/model-name';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { createConfigParser } from '../config-parser';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy, useResolvedVisionModel } from '../hooks/queries';
import { modelSelectionValue, parseModelSelection } from './model-id';
import { withGovernancePolicyReadBoundary } from './policy-read-boundary';

interface VisionModelEditorProps {
  organizationId: string;
}

const FORM_ID = 'governance-vision-model-form';

/** The Automatic row's value. Empty string is unusable — a model id can never
 * be empty, but a select needs a concrete value for its head option. */
const AUTOMATIC = '__automatic__';

const parseConfig = createConfigParser(
  visionModelConfigSchema,
  (): VisionModelConfig => ({}),
);

interface VisionModelForm {
  /** `AUTOMATIC` or a provider/model pair. */
  selection: string;
}

// =============================================================================
// Which model reads images for a text-only harness — the vision polyfill.
// Automatic is the default and the right answer for most organizations; the
// pin exists because the automatic pick reads a LIVE catalog, so it tracks
// whatever a provider listed most recently (observed live: a music generator
// whose token price is 0 because it bills per clip won the price sort, and
// every image read of the run got a provider 400).
//
// The resolved pick is rendered alongside, with its reason — this is the only
// surface anywhere that answers "which model is reading our images".
// =============================================================================
function VisionModelEditorContent({ organizationId }: VisionModelEditorProps) {
  const { t } = useT('governance');
  const ability = useAbility();
  const canEdit = ability.can('write', 'orgSettings');

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'vision_model',
  );
  const { data: catalogs } = useProviderCatalogs(organizationId);
  const { data: resolved } = useResolvedVisionModel(organizationId);
  const { mutateAsync: upsertMutation } = useUpsertGovernancePolicy({
    errorToast: false,
  });

  const savedConfig = useMemo(
    () => parseConfig(policy?.config),
    [policy?.config],
  );

  const data = useMemo<VisionModelForm>(
    () => ({
      selection:
        savedConfig.providerSlug !== undefined &&
        savedConfig.modelId !== undefined
          ? modelSelectionValue(savedConfig.providerSlug, savedConfig.modelId)
          : AUTOMATIC,
    }),
    [savedConfig],
  );

  const schema = useMemo(() => z.object({ selection: z.string().min(1) }), []);

  /**
   * Every model that could actually serve the lane. The eligibility filter
   * mirrors the resolver's: a model that cannot transcribe must not be
   * offerable, or the picker becomes a way to reproduce the exact outage the
   * pin is meant to prevent.
   */
  const eligibleModels = useMemo(() => {
    const eligible: ProvidedModel[] = [];
    for (const provider of catalogs ?? []) {
      for (const model of provider.models) {
        if (
          model.supportsVision &&
          model.tags.includes('chat') &&
          model.outputsMedia !== true &&
          !model.id.endsWith(':free')
        ) {
          eligible.push({
            id: model.id,
            providerSlug: provider.name,
            providerLabel: provider.displayName,
          });
        }
      }
    }
    return eligible;
  }, [catalogs]);

  /** Automatic plus the eligible models, grouped by provider. */
  const options = useMemo<SearchableSelectOption[]>(
    () => [
      {
        value: AUTOMATIC,
        label: t('visionModel.automaticLabel'),
        description: t('visionModel.automaticHint'),
      },
      ...modelOptionsByProvider(eligibleModels, (model) => ({
        value: modelSelectionValue(model.providerSlug, model.id),
      })),
    ],
    [eligibleModels, t],
  );

  const save = useCallback(
    async (values: VisionModelForm) => {
      const pinned =
        values.selection === AUTOMATIC
          ? null
          : parseModelSelection(values.selection);
      try {
        await upsertMutation({
          organizationId,
          policyType: 'vision_model',
          // Automatic is the EMPTY config, which is also what a missing file
          // means — the two must stay indistinguishable.
          config: (pinned ?? {}) satisfies VisionModelConfig,
        });
      } catch (err) {
        console.error('[visionModel save]', err);
        throw new Error(t('visionModel.saveFailed'), { cause: err });
      }
    },
    [organizationId, t, upsertMutation],
  );

  const editor = useFormEditor<VisionModelForm>({ data, schema, save });
  // Saving runs through the settings header's global Save/Discard cluster;
  // read-only viewers stay unregistered so the cluster never renders for a
  // section they cannot edit.
  useRegisterGroupedEditor(editor, { enabled: canEdit });

  const selection = editor.form.watch('selection');

  /** "Automatic" needs to say what it currently resolves to, or it reads as a
   * shrug. A pin needs no such line — the reader picked it. */
  const resolvedLine = useMemo(() => {
    if (selection !== AUTOMATIC) return null;
    if (resolved === undefined) return null;
    if (resolved === null) return t('visionModel.resolvedNone');
    return t(`visionModel.resolved.${resolved.source}`, {
      model: pickedModelName(
        { id: resolved.modelId, providerSlug: resolved.providerSlug },
        eligibleModels,
      ),
    });
  }, [eligibleModels, resolved, selection, t]);

  return (
    <Skeletonize loading={isLoading} label={t('visionModel.title')}>
      <SettingsSection
        title={t('visionModel.title')}
        description={t('visionModel.description')}
      >
        <form id={FORM_ID} onSubmit={editor.submit}>
          <fieldset
            disabled={!canEdit || editor.isLoading}
            className="contents"
          >
            <SettingsFieldList>
              <SettingsFieldRow
                label={t('visionModel.label')}
                description={t('visionModel.labelHint')}
              >
                <div className="flex w-full flex-col gap-1">
                  <SearchableSelect
                    aria-label={t('visionModel.label')}
                    placeholder={t('visionModel.automaticLabel')}
                    disabled={!canEdit}
                    value={selection}
                    onValueChange={(value) =>
                      editor.form.setValue('selection', value, {
                        shouldDirty: true,
                      })
                    }
                    options={options}
                    searchPlaceholder={t('visionModel.searchModels')}
                    emptyText={t('visionModel.noModelsFound')}
                  />
                  {resolvedLine !== null && (
                    <Text as="p" variant="muted" className="text-xs">
                      {resolvedLine}
                    </Text>
                  )}
                </div>
              </SettingsFieldRow>
            </SettingsFieldList>
          </fieldset>
        </form>
      </SettingsSection>
    </Skeletonize>
  );
}

export const VisionModelEditor = withGovernancePolicyReadBoundary(
  VisionModelEditorContent,
  'vision_model',
);
