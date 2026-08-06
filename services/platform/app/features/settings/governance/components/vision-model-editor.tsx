'use client';

import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import {
  useFormEditor,
  useRegisterGroupedEditor,
} from '@/app/components/ui/editor';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useProviderCatalogs } from '@/app/features/settings/providers/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import {
  type VisionModelConfig,
  visionModelConfigSchema,
} from '@/lib/shared/schemas/governance';

import { createConfigParser } from '../config-parser';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy, useResolvedVisionModel } from '../hooks/queries';

interface VisionModelEditorProps {
  organizationId: string;
}

const FORM_ID = 'governance-vision-model-form';

/** The Automatic row's value. Empty string is unusable — a model id can never
 * be empty, but a select needs a concrete value for its head option. */
const AUTOMATIC = '__automatic__';

/** `<providerSlug>::<modelId>` — one select over both fields, because they are
 * only ever meaningful together (a provider cannot route without a model). */
function pinValue(providerSlug: string, modelId: string): string {
  return `${providerSlug}::${modelId}`;
}

function parsePinValue(
  value: string,
): { providerSlug: string; modelId: string } | null {
  const at = value.indexOf('::');
  if (at <= 0) return null;
  const providerSlug = value.slice(0, at);
  const modelId = value.slice(at + 2);
  return modelId === '' ? null : { providerSlug, modelId };
}

const parseConfig = createConfigParser(
  visionModelConfigSchema,
  (): VisionModelConfig => ({}),
);

interface VisionModelForm {
  /** `AUTOMATIC` or a `pinValue`. */
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
export function VisionModelEditor({ organizationId }: VisionModelEditorProps) {
  const { t } = useT('governance');
  const ability = useAbility();
  const canEdit = ability.can('write', 'orgSettings');

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'vision_model',
  );
  const { data: catalogs } = useProviderCatalogs(organizationId);
  const { data: resolved } = useResolvedVisionModel(organizationId);
  const { mutateAsync: upsertMutation } = useUpsertGovernancePolicy();

  const savedConfig = useMemo(
    () => parseConfig(policy?.config),
    [policy?.config],
  );

  const data = useMemo<VisionModelForm>(
    () => ({
      selection:
        savedConfig.providerSlug !== undefined &&
        savedConfig.modelId !== undefined
          ? pinValue(savedConfig.providerSlug, savedConfig.modelId)
          : AUTOMATIC,
    }),
    [savedConfig],
  );

  const schema = useMemo(() => z.object({ selection: z.string().min(1) }), []);

  /**
   * Automatic plus every model that could actually serve the lane, grouped by
   * provider. The eligibility filter mirrors the resolver's: a model that
   * cannot transcribe must not be offerable, or the picker becomes a way to
   * reproduce the exact outage the pin is meant to prevent.
   */
  const options = useMemo<SearchableSelectOption[]>(() => {
    const rows: SearchableSelectOption[] = [
      {
        value: AUTOMATIC,
        label: t('visionModel.automaticLabel'),
        description: t('visionModel.automaticHint'),
      },
    ];
    for (const provider of catalogs ?? []) {
      const eligible = provider.models.filter(
        (model) =>
          model.supportsVision &&
          model.tags.includes('chat') &&
          model.outputsMedia !== true &&
          !model.id.endsWith(':free'),
      );
      if (eligible.length === 0) continue;
      rows.push({
        value: `header:${provider.name}`,
        label: provider.displayName,
        isSectionHeader: true,
      });
      for (const model of eligible) {
        rows.push({
          value: pinValue(provider.name, model.id),
          label: model.id,
        });
      }
    }
    return rows;
  }, [catalogs, t]);

  const save = useCallback(
    async (values: VisionModelForm) => {
      const pinned =
        values.selection === AUTOMATIC ? null : parsePinValue(values.selection);
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
      model: `${resolved.providerSlug} · ${resolved.modelId}`,
    });
  }, [resolved, selection, t]);

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
