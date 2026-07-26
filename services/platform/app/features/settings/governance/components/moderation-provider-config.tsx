'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useCallback, useMemo, useRef, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  moderationProviderConfigSchema,
  type ModerationCategoryMapping,
  type ModerationProviderConfig,
  type ModerationResponseShape,
} from '@/lib/shared/schemas/governance';

import { mapGovernanceSaveError } from '../governance-save-errors';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { ApiKeyPanel } from './moderation-api-key-panel';
import { EndpointEditDialog } from './moderation-endpoint-edit-dialog';
import { EndpointSummary } from './moderation-endpoint-summary';
import { MappingEditDialog } from './moderation-mapping-edit-dialog';
import { MappingList } from './moderation-mapping-list';
import {
  DEFAULT_DRAFT,
  MODERATION_PRESETS,
  presetActiveLabelKey,
  presetLabelKey,
  presetNoteKey,
  type CustomCategoryShape,
  type EndpointDraft,
  type HeaderRow,
  type MappingDraft,
  type ModerationDraft,
  type ModerationPreset,
} from './moderation-presets';
import { TestConnectionPanel } from './moderation-test-connection-panel';

interface ModerationProviderConfigProps {
  organizationId: string;
}

type ModerationPolicy = ReturnType<typeof useGovernancePolicy>['data'];

/**
 * Derive the editor draft from the persisted policy. Returns the defaults
 * (so the masked-during-load view still has a valid shape to render) when
 * there's no policy yet or the stored config fails schema validation.
 */
function deriveDraft(policy: ModerationPolicy): ModerationDraft {
  if (!policy) return DEFAULT_DRAFT;
  const parsed = moderationProviderConfigSchema.safeParse(policy.config);
  if (!parsed.success) return DEFAULT_DRAFT;
  const config = parsed.data;
  const shape = config.responseShape;
  return {
    enabled: policy.enabled ?? config.enabled ?? false,
    appliesToInput: config.appliesTo?.includes('input') ?? true,
    appliesToOutput: config.appliesTo?.includes('output') ?? false,
    url: config.endpoint?.url ?? '',
    headers: Object.entries(config.endpoint?.headers ?? {}).map(
      ([key, value]) => ({ key, value }),
    ),
    requestTemplate: config.endpoint?.requestTemplate ?? '',
    timeoutMs: String(config.endpoint?.timeoutMs ?? 3000),
    responseShape: shape?.type ?? 'openai_moderation',
    customFlaggedPath:
      shape?.type === 'custom_jsonpath' ? (shape.flaggedPath ?? '') : '',
    customCategoriesPath:
      shape?.type === 'custom_jsonpath' ? (shape.categoriesPath ?? '') : '',
    customCategoryShape:
      shape?.type === 'custom_jsonpath'
        ? shape.categoryShape
        : 'record_of_bool',
    failInput: config.failBehavior?.input ?? 'open',
    failOutput: config.failBehavior?.output ?? 'closed',
    mappings: config.categoryMappings ?? [],
  };
}

// =============================================================================
// Container — owns data fetching, local edit state, save/toast wiring, and the
// loading state. Wraps the plain `ModerationProviderConfigForm` in
// `<Skeletonize>` so the same tree renders the skeleton (the hand-rolled
// loading `SettingsSection` with magic-height `Skeleton` boxes is gone — the
// skeleton-aware `<Switch>` masks itself to its real track height).
//
// All draft fields are seeded LAZILY from the (possibly already-warm) policy so
// the first render shows real values — replacing the post-mount
// `useEffect`/`initializedRef` swap that flashed defaults for a frame on warm
// navigations. A one-time render-time sync still adopts a cold read once it
// lands (pre-commit → no flicker); after that, edits are client-owned and the
// optimistic upsert keeps the server read in step.
//
// NOTE: exported as `ModerationProviderConfigView` because the guardrails route
// already imports that name as the entry point — keep it stable.
// =============================================================================
export function ModerationProviderConfigView({
  organizationId,
}: ModerationProviderConfigProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'moderation_provider',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const initial = useMemo(() => deriveDraft(policy), [policy]);

  const [enabled, setEnabled] = useState(initial.enabled);
  const [appliesToInput, setAppliesToInput] = useState(initial.appliesToInput);
  const [appliesToOutput, setAppliesToOutput] = useState(
    initial.appliesToOutput,
  );
  const [url, setUrl] = useState(initial.url);
  const [headers, setHeaders] = useState(initial.headers);
  const [requestTemplate, setRequestTemplate] = useState(
    initial.requestTemplate,
  );
  const [timeoutMs, setTimeoutMs] = useState(initial.timeoutMs);
  const [responseShape, setResponseShape] = useState<
    ModerationResponseShape['type']
  >(initial.responseShape);
  const [customFlaggedPath, setCustomFlaggedPath] = useState(
    initial.customFlaggedPath,
  );
  const [customCategoriesPath, setCustomCategoriesPath] = useState(
    initial.customCategoriesPath,
  );
  const [customCategoryShape, setCustomCategoryShape] =
    useState<CustomCategoryShape>(initial.customCategoryShape);
  const [failInput, setFailInput] = useState<'open' | 'closed'>(
    initial.failInput,
  );
  const [failOutput, setFailOutput] = useState<'open' | 'closed'>(
    initial.failOutput,
  );
  const [mappings, setMappings] = useState(initial.mappings);

  const [endpointDialogOpen, setEndpointDialogOpen] = useState(false);
  const [deletingMappingIndex, setDeletingMappingIndex] = useState<
    number | null
  >(null);
  const [mappingEditorIndex, setMappingEditorIndex] = useState<
    number | 'new' | null
  >(null);

  const cannotManage = ability.cannot('write', 'orgSettings');

  // One-time sync for the cold-load case: the lazy seeds above ran against an
  // absent policy, so adopt the real config the first render it lands. Runs
  // pre-commit, so no default→real flash; afterwards edits stay client-owned.
  const syncedRef = useRef(policy != null);
  if (!syncedRef.current && policy != null) {
    syncedRef.current = true;
    setEnabled(initial.enabled);
    setAppliesToInput(initial.appliesToInput);
    setAppliesToOutput(initial.appliesToOutput);
    setUrl(initial.url);
    setHeaders(initial.headers);
    setRequestTemplate(initial.requestTemplate);
    setTimeoutMs(initial.timeoutMs);
    setResponseShape(initial.responseShape);
    setCustomFlaggedPath(initial.customFlaggedPath);
    setCustomCategoriesPath(initial.customCategoriesPath);
    setCustomCategoryShape(initial.customCategoryShape);
    setFailInput(initial.failInput);
    setFailOutput(initial.failOutput);
    setMappings(initial.mappings);
  }

  /**
   * Build the complete ModerationProviderConfig using current state, with any
   * caller-supplied overrides. Every inline toggle / select hands its next
   * value here so the saved config never lags behind the visible one.
   */
  const buildConfig = useCallback(
    (overrides: {
      enabled?: boolean;
      appliesToInput?: boolean;
      appliesToOutput?: boolean;
      url?: string;
      headers?: HeaderRow[];
      requestTemplate?: string;
      timeoutMs?: string;
      responseShape?: ModerationResponseShape['type'];
      customFlaggedPath?: string;
      customCategoriesPath?: string;
      customCategoryShape?: MappingDraft['scoreThresholdText'] extends string
        ? 'array' | 'record_of_bool' | 'record_of_score'
        : never;
      failInput?: 'open' | 'closed';
      failOutput?: 'open' | 'closed';
      mappings?: ModerationCategoryMapping[];
    }): ModerationProviderConfig => {
      const nextInput = overrides.appliesToInput ?? appliesToInput;
      const nextOutput = overrides.appliesToOutput ?? appliesToOutput;
      const appliesTo: Array<'input' | 'output'> = [];
      if (nextInput) appliesTo.push('input');
      if (nextOutput) appliesTo.push('output');
      if (appliesTo.length === 0) appliesTo.push('input');

      const headersRecord: Record<string, string> = {};
      for (const row of overrides.headers ?? headers) {
        if (row.key.trim().length > 0)
          headersRecord[row.key.trim()] = row.value;
      }

      const nextShape = overrides.responseShape ?? responseShape;
      const shape: ModerationResponseShape =
        nextShape === 'custom_jsonpath'
          ? {
              type: 'custom_jsonpath',
              flaggedPath:
                (overrides.customFlaggedPath ?? customFlaggedPath) || undefined,
              categoriesPath:
                overrides.customCategoriesPath ?? customCategoriesPath,
              categoryShape:
                overrides.customCategoryShape ?? customCategoryShape,
            }
          : { type: nextShape };

      const resolvedUrl = overrides.url ?? url;

      return {
        enabled: overrides.enabled ?? enabled,
        appliesTo,
        endpoint: {
          url: resolvedUrl,
          method: 'POST',
          headers: headersRecord,
          requestTemplate: overrides.requestTemplate ?? requestTemplate,
          timeoutMs: Number(overrides.timeoutMs ?? timeoutMs) || 3000,
          maxResponseBytes: 262_144,
          bufferPolicy: {
            minFlushChars: 120,
            maxBufferChars: 800,
            idleFlushMs: 400,
            perStreamMaxConcurrent: 2,
          },
        },
        responseShape: shape,
        categoryMappings: overrides.mappings ?? mappings,
        failBehavior: {
          input: overrides.failInput ?? failInput,
          output: overrides.failOutput ?? failOutput,
        },
        configVersion: 1,
      };
    },
    [
      enabled,
      appliesToInput,
      appliesToOutput,
      url,
      headers,
      requestTemplate,
      timeoutMs,
      responseShape,
      customFlaggedPath,
      customCategoriesPath,
      customCategoryShape,
      failInput,
      failOutput,
      mappings,
    ],
  );

  const saveWith = useCallback(
    async (config: ModerationProviderConfig) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'moderation_provider',
          config,
        });
        toast({
          title: t('moderationProvider.saved'),
          variant: 'success',
        });
      } catch (error) {
        toast({
          title: mapGovernanceSaveError(
            error,
            t,
            t('moderationProvider.saveFailed'),
          ),
          variant: 'destructive',
        });
      }
    },
    [upsertMutation, organizationId, toast, t],
  );

  const handleToggleEnabled = useCallback(
    (checked: boolean) => {
      setEnabled(checked);
      // Enabling with an unconfigured endpoint fails the server's Zod gate
      // (`endpoint.url` must be a valid URL) and the enable silently never
      // persists. Flip the toggle locally so the config — including the
      // Endpoint editor — expands, but defer the save until a URL exists; the
      // inline hint tells the admin what's missing. Mirrors the
      // custom_jsonpath deferral below. Disabling always persists.
      if (checked && !url.trim()) {
        return;
      }
      void saveWith(buildConfig({ enabled: checked }));
    },
    [buildConfig, saveWith, url],
  );

  const handleAppliesToInput = useCallback(
    (checked: boolean) => {
      setAppliesToInput(checked);
      void saveWith(buildConfig({ appliesToInput: checked }));
    },
    [buildConfig, saveWith],
  );

  const handleAppliesToOutput = useCallback(
    (checked: boolean) => {
      setAppliesToOutput(checked);
      void saveWith(buildConfig({ appliesToOutput: checked }));
    },
    [buildConfig, saveWith],
  );

  const handleResponseShapeChange = useCallback(
    (value: ModerationResponseShape['type']) => {
      setResponseShape(value);
      // Switching TO custom_jsonpath from a built-in preset typically
      // leaves `categoriesPath` empty, which fails server-side Zod
      // validation (`>=1 characters`) with a cryptic error toast. Defer
      // the save until the user supplies a non-empty path via the
      // Endpoint dialog. Built-in presets have no required fields, so
      // auto-saving those remains safe.
      if (value === 'custom_jsonpath' && !customCategoriesPath.trim()) {
        return;
      }
      void saveWith(buildConfig({ responseShape: value }));
    },
    [buildConfig, saveWith, customCategoriesPath],
  );

  const handleFailInputChange = useCallback(
    (value: 'open' | 'closed') => {
      setFailInput(value);
      void saveWith(buildConfig({ failInput: value }));
    },
    [buildConfig, saveWith],
  );

  const handleFailOutputChange = useCallback(
    (value: 'open' | 'closed') => {
      setFailOutput(value);
      void saveWith(buildConfig({ failOutput: value }));
    },
    [buildConfig, saveWith],
  );

  const handleApplyPreset = useCallback(
    (preset: ModerationPreset) => {
      setUrl(preset.url);
      setHeaders(preset.headers);
      setRequestTemplate(preset.requestTemplate);
      setResponseShape(preset.id);

      // Seed default category mappings ONLY when the admin has none
      // configured yet — otherwise re-applying the preset to tweak URL
      // or headers would silently blow away their custom mapping list.
      // This is what makes the provider actually do something on first
      // enable; without mappings the HTTP call still runs but no
      // detection ever surfaces.
      const seededMappings =
        mappings.length === 0
          ? preset.defaultMappings.map((m) => ({ ...m }))
          : mappings;
      if (seededMappings !== mappings) {
        setMappings(seededMappings);
      }

      const noteKey = presetNoteKey(preset.id);
      if (noteKey) {
        toast({
          title: t('moderationProvider.presetApplied'),
          description: t(noteKey),
        });
      } else if (seededMappings !== mappings) {
        toast({
          title: t('moderationProvider.presetApplied'),
          description: t('moderationProvider.presetAppliedMappings', {
            count: preset.defaultMappings.length,
          }),
        });
      }
      void saveWith(
        buildConfig({
          url: preset.url,
          headers: preset.headers,
          requestTemplate: preset.requestTemplate,
          responseShape: preset.id,
          mappings: seededMappings,
        }),
      );
    },
    [buildConfig, mappings, saveWith, toast, t],
  );

  const handleSaveEndpoint = useCallback(
    (draft: EndpointDraft) => {
      setUrl(draft.url);
      setHeaders(draft.headers);
      setRequestTemplate(draft.requestTemplate);
      setTimeoutMs(draft.timeoutMs);
      setCustomFlaggedPath(draft.customFlaggedPath);
      setCustomCategoriesPath(draft.customCategoriesPath);
      setCustomCategoryShape(draft.customCategoryShape);
      setEndpointDialogOpen(false);
      void saveWith(
        buildConfig({
          url: draft.url,
          headers: draft.headers,
          requestTemplate: draft.requestTemplate,
          timeoutMs: draft.timeoutMs,
          customFlaggedPath: draft.customFlaggedPath,
          customCategoriesPath: draft.customCategoriesPath,
        }),
      );
    },
    [buildConfig, saveWith],
  );

  const handleSaveMapping = useCallback(
    (index: number | 'new', draft: ModerationCategoryMapping) => {
      const next =
        index === 'new'
          ? [...mappings, draft]
          : mappings.map((m, i) => (i === index ? draft : m));
      setMappings(next);
      setMappingEditorIndex(null);
      void saveWith(buildConfig({ mappings: next }));
    },
    [buildConfig, mappings, saveWith],
  );

  const handleDeleteMapping = useCallback(
    (index: number) => {
      const next = mappings.filter((_, i) => i !== index);
      setMappings(next);
      setMappingEditorIndex(null);
      void saveWith(buildConfig({ mappings: next }));
    },
    [buildConfig, mappings, saveWith],
  );

  const endpointDraft: EndpointDraft = {
    url,
    headers,
    requestTemplate,
    timeoutMs,
    customFlaggedPath,
    customCategoriesPath,
    customCategoryShape,
  };

  return (
    <Skeletonize loading={isLoading} label={t('moderationProvider.title')}>
      <SettingsSection
        id="guardrails-moderation"
        title={t('moderationProvider.title')}
        description={t('moderationProvider.description')}
        action={
          <Switch
            aria-label={t('moderationProvider.enableLabel')}
            checked={enabled}
            disabled={cannotManage}
            onCheckedChange={handleToggleEnabled}
          />
        }
      >
        {cannotManage && (
          <Alert
            variant="warning"
            description={t('moderationProvider.cannotManage')}
          />
        )}

        {enabled && (
          <>
            {!url.trim() && (
              <Alert
                variant="warning"
                description={t('moderationProvider.enableNeedsEndpoint')}
              />
            )}

            {/* One divided list for the section's settings — label + hint
                left, control right, like every other section. Marked so the
                shared divider rule separates it from the mappings block. */}
            <SettingsFieldList data-settings-section="">
              <SettingsFieldRow label={t('moderationProvider.applyTo')}>
                <Stack gap={2}>
                  <Checkbox
                    label={t('moderationProvider.userInput')}
                    checked={appliesToInput}
                    disabled={cannotManage}
                    onCheckedChange={(v) => handleAppliesToInput(Boolean(v))}
                  />
                  <Checkbox
                    label={t('moderationProvider.modelOutput')}
                    checked={appliesToOutput}
                    disabled={cannotManage}
                    onCheckedChange={(v) => handleAppliesToOutput(Boolean(v))}
                  />
                </Stack>
              </SettingsFieldRow>

              <SettingsFieldRow
                label={t('moderationProvider.failBehavior')}
                description={t('moderationProvider.failBehaviorDescription')}
              >
                <Stack gap={3}>
                  <div>
                    <div className="text-muted-foreground mb-1 text-xs">
                      {t('moderationProvider.input')}
                    </div>
                    <Select
                      aria-label={t('moderationProvider.input')}
                      value={failInput}
                      disabled={cannotManage}
                      onValueChange={(v) => {
                        if (v === 'open' || v === 'closed')
                          handleFailInputChange(v);
                      }}
                      options={[
                        {
                          value: 'open',
                          label: t('moderationProvider.failOpen'),
                        },
                        {
                          value: 'closed',
                          label: t('moderationProvider.failClosed'),
                        },
                      ]}
                    />
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1 text-xs">
                      {t('moderationProvider.output')}
                    </div>
                    <Select
                      aria-label={t('moderationProvider.output')}
                      value={failOutput}
                      disabled={cannotManage}
                      onValueChange={(v) => {
                        if (v === 'open' || v === 'closed')
                          handleFailOutputChange(v);
                      }}
                      options={[
                        {
                          value: 'open',
                          label: t('moderationProvider.failOpen'),
                        },
                        {
                          value: 'closed',
                          label: t('moderationProvider.failClosed'),
                        },
                      ]}
                    />
                  </div>
                </Stack>
              </SettingsFieldRow>

              <SettingsFieldRow
                label={t('moderationProvider.provider')}
                description={t('moderationProvider.providerDescription')}
                wideControl
              >
                <Row gap={2} align="stretch" wrap>
                  {MODERATION_PRESETS.map((preset) => {
                    const active = responseShape === preset.id;
                    const label = active
                      ? `✓ ${t(presetActiveLabelKey(preset.id))}`
                      : t(presetLabelKey(preset.id));
                    return (
                      <Button
                        key={preset.id}
                        variant={active ? 'primary' : 'secondary'}
                        size="sm"
                        disabled={cannotManage}
                        onClick={() => handleApplyPreset(preset)}
                      >
                        {label}
                      </Button>
                    );
                  })}
                  <Button
                    variant={
                      responseShape === 'custom_jsonpath'
                        ? 'primary'
                        : 'secondary'
                    }
                    size="sm"
                    disabled={cannotManage}
                    onClick={() => handleResponseShapeChange('custom_jsonpath')}
                  >
                    {responseShape === 'custom_jsonpath'
                      ? `✓ ${t('moderationProvider.presetCustomJsonPathActive')}`
                      : t('moderationProvider.presetCustomJsonPath')}
                  </Button>
                </Row>
                {responseShape === 'custom_jsonpath' &&
                  !customCategoriesPath.trim() && (
                    <p className="mt-2 text-xs text-amber-600">
                      {t('moderationProvider.customJsonPathHint')}
                    </p>
                  )}
              </SettingsFieldRow>

              <SettingsFieldRow
                label={t('moderationProvider.endpoint')}
                description={t('moderationProvider.endpointDescription')}
              >
                <EndpointSummary
                  url={url}
                  headersCount={
                    headers.filter((h) => h.key.trim().length > 0).length
                  }
                  timeoutMs={timeoutMs}
                  onEdit={() => setEndpointDialogOpen(true)}
                  disabled={cannotManage}
                />
              </SettingsFieldRow>
            </SettingsFieldList>

            <ApiKeyPanel
              organizationId={organizationId}
              disabled={cannotManage}
            />

            <FormSection
              label={t('moderationProvider.categoryMappings')}
              description={t('moderationProvider.categoryMappingsDescription')}
              data-settings-section=""
            >
              {mappings.length === 0 && (
                <Alert
                  variant="warning"
                  description={t('moderationProvider.mappingsWarning')}
                />
              )}
              <MappingList
                mappings={mappings}
                disabled={cannotManage}
                onAdd={() => setMappingEditorIndex('new')}
                onEdit={(index) => setMappingEditorIndex(index)}
              />
            </FormSection>

            <TestConnectionPanel
              organizationId={organizationId}
              disabled={cannotManage}
            />

            {endpointDialogOpen && (
              <EndpointEditDialog
                open={endpointDialogOpen}
                initial={endpointDraft}
                responseShape={responseShape}
                onCancel={() => setEndpointDialogOpen(false)}
                onSave={handleSaveEndpoint}
              />
            )}

            {mappingEditorIndex !== null && (
              <MappingEditDialog
                index={mappingEditorIndex}
                initial={
                  mappingEditorIndex === 'new'
                    ? undefined
                    : mappings[mappingEditorIndex]
                }
                onCancel={() => setMappingEditorIndex(null)}
                onSave={(draft) => handleSaveMapping(mappingEditorIndex, draft)}
                onDelete={
                  mappingEditorIndex === 'new'
                    ? undefined
                    : () => {
                        if (typeof mappingEditorIndex === 'number') {
                          setDeletingMappingIndex(mappingEditorIndex);
                        }
                      }
                }
              />
            )}

            <ConfirmDialog
              open={deletingMappingIndex !== null}
              onOpenChange={(open) => {
                if (!open) setDeletingMappingIndex(null);
              }}
              title={t('moderationProvider.deleteMappingConfirmTitle')}
              description={t(
                'moderationProvider.deleteMappingConfirmDescription',
              )}
              confirmText={t('moderationProvider.deleteMappingConfirmAction')}
              variant="destructive"
              onConfirm={() => {
                if (deletingMappingIndex !== null) {
                  handleDeleteMapping(deletingMappingIndex);
                  setDeletingMappingIndex(null);
                }
              }}
            />
          </>
        )}
      </SettingsSection>
    </Skeletonize>
  );
}
