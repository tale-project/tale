'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Alert } from '@/app/components/ui/feedback/alert';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Button } from '@/app/components/ui/primitives/button';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  moderationProviderConfigSchema,
  type ModerationCategoryMapping,
  type ModerationProviderConfig,
  type ModerationResponseShape,
} from '@/lib/shared/schemas/governance';

import {
  useSaveModerationSecret,
  useTestModerationProvider,
  useUpsertGovernancePolicy,
} from '../hooks/mutations';
import {
  useGovernancePolicy,
  useModerationSecretStatus,
} from '../hooks/queries';

// Each preset pre-fills URL / headers / request template for a known
// provider and flips the response shape to the matching built-in adapter.
// The API key itself is entered in the "API key" section below — it's
// AES-encrypted server-side and stored in the `governanceSecrets` table;
// `{{secret}}` in header values is replaced with the decrypted value at
// request time, so the plaintext key never sits in the policy config.
interface ModerationPreset {
  id: 'openai_moderation' | 'azure_content_safety' | 'perspective';
  url: string;
  headers: HeaderRow[];
  requestTemplate: string;
  // A minimal set of category→label mappings so enabling the provider
  // actually does something without further configuration. Admins can
  // tune modes / thresholds / delete entries after applying.
  defaultMappings: ModerationCategoryMapping[];
}

// All defaults are `flag` mode — detection only, nothing blocked. Admins
// can escalate to mask/block once they've watched Recent Events and are
// confident about false-positive rates on their traffic.
const MODERATION_PRESETS: ModerationPreset[] = [
  {
    id: 'openai_moderation',
    url: 'https://api.openai.com/v1/moderations',
    headers: [
      { key: 'Authorization', value: 'Bearer {{secret}}' },
      { key: 'Content-Type', value: 'application/json' },
    ],
    requestTemplate: '{"input": {{text}}, "model": "omni-moderation-latest"}',
    defaultMappings: [
      {
        providerCategory: 'harassment',
        internalLabel: 'Harassment',
        enabled: true,
        mode: 'flag',
      },
      {
        providerCategory: 'hate',
        internalLabel: 'Hate',
        enabled: true,
        mode: 'flag',
      },
      {
        providerCategory: 'violence',
        internalLabel: 'Violence',
        enabled: true,
        mode: 'flag',
      },
      {
        providerCategory: 'sexual',
        internalLabel: 'Sexual',
        enabled: true,
        mode: 'flag',
      },
      {
        providerCategory: 'self-harm',
        internalLabel: 'Self-harm',
        enabled: true,
        mode: 'flag',
      },
    ],
  },
  {
    id: 'azure_content_safety',
    url: 'https://YOUR-RESOURCE.cognitiveservices.azure.com/contentsafety/text:analyze?api-version=2024-09-01',
    headers: [
      { key: 'Ocp-Apim-Subscription-Key', value: '{{secret}}' },
      { key: 'Content-Type', value: 'application/json' },
    ],
    requestTemplate:
      '{"text": {{text}}, "categories": ["Hate","Violence","Sexual","SelfHarm"], "outputType": "FourSeverityLevels"}',
    defaultMappings: [
      {
        providerCategory: 'Hate',
        internalLabel: 'Hate',
        enabled: true,
        mode: 'flag',
      },
      {
        providerCategory: 'Violence',
        internalLabel: 'Violence',
        enabled: true,
        mode: 'flag',
      },
      {
        providerCategory: 'Sexual',
        internalLabel: 'Sexual',
        enabled: true,
        mode: 'flag',
      },
      {
        providerCategory: 'SelfHarm',
        internalLabel: 'Self-harm',
        enabled: true,
        mode: 'flag',
      },
    ],
  },
  {
    id: 'perspective',
    url: 'https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze',
    headers: [{ key: 'Content-Type', value: 'application/json' }],
    requestTemplate:
      '{"comment": {"text": {{text}}}, "languages": ["en"], "requestedAttributes": {"TOXICITY": {}, "INSULT": {}, "THREAT": {}, "IDENTITY_ATTACK": {}, "PROFANITY": {}, "SEVERE_TOXICITY": {}}}',
    defaultMappings: [
      {
        providerCategory: 'TOXICITY',
        internalLabel: 'Toxicity',
        enabled: true,
        mode: 'flag',
        scoreThreshold: 0.7,
      },
      {
        providerCategory: 'SEVERE_TOXICITY',
        internalLabel: 'Severe toxicity',
        enabled: true,
        mode: 'flag',
        scoreThreshold: 0.7,
      },
      {
        providerCategory: 'THREAT',
        internalLabel: 'Threat',
        enabled: true,
        mode: 'flag',
        scoreThreshold: 0.7,
      },
      {
        providerCategory: 'IDENTITY_ATTACK',
        internalLabel: 'Identity attack',
        enabled: true,
        mode: 'flag',
        scoreThreshold: 0.7,
      },
    ],
  },
];

interface HeaderRow {
  key: string;
  value: string;
}

type EndpointDraft = {
  url: string;
  headers: HeaderRow[];
  requestTemplate: string;
  timeoutMs: string;
  customFlaggedPath: string;
  customCategoriesPath: string;
  customCategoryShape: 'array' | 'record_of_bool' | 'record_of_score';
};

type MappingDraft = ModerationCategoryMapping & { scoreThresholdText: string };

function presetLabelKey(id: ModerationPreset['id']): string {
  if (id === 'openai_moderation') return 'moderationProvider.presetOpenai';
  if (id === 'azure_content_safety') return 'moderationProvider.presetAzure';
  return 'moderationProvider.presetPerspective';
}

function presetActiveLabelKey(id: ModerationPreset['id']): string {
  if (id === 'openai_moderation')
    return 'moderationProvider.presetOpenaiActive';
  if (id === 'azure_content_safety')
    return 'moderationProvider.presetAzureActive';
  return 'moderationProvider.presetPerspectiveActive';
}

function presetNoteKey(id: ModerationPreset['id']): string | null {
  if (id === 'azure_content_safety')
    return 'moderationProvider.presetAzureNote';
  if (id === 'perspective') return 'moderationProvider.presetPerspectiveNote';
  return null;
}

interface ModerationProviderConfigProps {
  organizationId: string;
}

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

  const [enabled, setEnabled] = useState(false);
  const [appliesToInput, setAppliesToInput] = useState(true);
  const [appliesToOutput, setAppliesToOutput] = useState(false);
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [requestTemplate, setRequestTemplate] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('3000');
  const [responseShape, setResponseShape] =
    useState<ModerationResponseShape['type']>('openai_moderation');
  const [customFlaggedPath, setCustomFlaggedPath] = useState('');
  const [customCategoriesPath, setCustomCategoriesPath] = useState('');
  const [customCategoryShape, setCustomCategoryShape] = useState<
    'array' | 'record_of_bool' | 'record_of_score'
  >('record_of_bool');
  const [failInput, setFailInput] = useState<'open' | 'closed'>('open');
  const [failOutput, setFailOutput] = useState<'open' | 'closed'>('closed');
  const [mappings, setMappings] = useState<ModerationCategoryMapping[]>([]);

  const [endpointDialogOpen, setEndpointDialogOpen] = useState(false);
  const [mappingEditorIndex, setMappingEditorIndex] = useState<
    number | 'new' | null
  >(null);

  const cannotManage = ability.cannot('write', 'orgSettings');
  const initializedRef = useRef(false);

  if (!isLoading && !initializedRef.current && policy) {
    initializedRef.current = true;
    const parsed = moderationProviderConfigSchema.safeParse(policy.config);
    if (parsed.success) {
      const config = parsed.data;
      setEnabled(policy.enabled ?? config.enabled ?? false);
      setAppliesToInput(config.appliesTo?.includes('input') ?? true);
      setAppliesToOutput(config.appliesTo?.includes('output') ?? false);
      setUrl(config.endpoint?.url ?? '');
      setHeaders(
        Object.entries(config.endpoint?.headers ?? {}).map(([key, value]) => ({
          key,
          value,
        })),
      );
      setRequestTemplate(config.endpoint?.requestTemplate ?? '');
      setTimeoutMs(String(config.endpoint?.timeoutMs ?? 3000));
      setResponseShape(config.responseShape?.type ?? 'openai_moderation');
      if (config.responseShape?.type === 'custom_jsonpath') {
        setCustomFlaggedPath(config.responseShape.flaggedPath ?? '');
        setCustomCategoriesPath(config.responseShape.categoriesPath ?? '');
        setCustomCategoryShape(config.responseShape.categoryShape);
      }
      setFailInput(config.failBehavior?.input ?? 'open');
      setFailOutput(config.failBehavior?.output ?? 'closed');
      setMappings(config.categoryMappings ?? []);
    }
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
        const message =
          error instanceof Error
            ? error.message
            : t('moderationProvider.saveFailed');
        toast({ title: message, variant: 'destructive' });
      }
    },
    [upsertMutation, organizationId, toast, t],
  );

  const handleToggleEnabled = useCallback(
    (checked: boolean) => {
      setEnabled(checked);
      void saveWith(buildConfig({ enabled: checked }));
    },
    [buildConfig, saveWith],
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

  if (isLoading) {
    return (
      <PageSection title={t('moderationProvider.title')}>
        <Skeleton className="h-32 w-full" />
      </PageSection>
    );
  }

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
    <PageSection
      title={t('moderationProvider.title')}
      description={t('moderationProvider.description', {
        secretPlaceholder: '{{secret}}',
      })}
      action={
        <Switch
          label={t('moderationProvider.enableLabel')}
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
          <FormSection label={t('moderationProvider.applyTo')}>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={appliesToInput}
                  disabled={cannotManage}
                  onChange={(e) => handleAppliesToInput(e.target.checked)}
                />
                <span>{t('moderationProvider.userInput')}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={appliesToOutput}
                  disabled={cannotManage}
                  onChange={(e) => handleAppliesToOutput(e.target.checked)}
                />
                <span>{t('moderationProvider.modelOutput')}</span>
              </label>
            </div>
          </FormSection>

          <FormSection
            label={t('moderationProvider.failBehavior')}
            description={t('moderationProvider.failBehaviorDescription')}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-muted-foreground mb-1 text-xs">
                  {t('moderationProvider.input')}
                </div>
                <Select
                  value={failInput}
                  disabled={cannotManage}
                  onValueChange={(v) => {
                    if (v === 'open' || v === 'closed')
                      handleFailInputChange(v);
                  }}
                  options={[
                    { value: 'open', label: t('moderationProvider.failOpen') },
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
                  value={failOutput}
                  disabled={cannotManage}
                  onValueChange={(v) => {
                    if (v === 'open' || v === 'closed')
                      handleFailOutputChange(v);
                  }}
                  options={[
                    { value: 'open', label: t('moderationProvider.failOpen') },
                    {
                      value: 'closed',
                      label: t('moderationProvider.failClosed'),
                    },
                  ]}
                />
              </div>
            </div>
          </FormSection>

          <FormSection
            label={t('moderationProvider.provider')}
            description={t('moderationProvider.providerDescription')}
          >
            <div className="flex flex-wrap gap-2">
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
                  responseShape === 'custom_jsonpath' ? 'primary' : 'secondary'
                }
                size="sm"
                disabled={cannotManage}
                onClick={() => handleResponseShapeChange('custom_jsonpath')}
              >
                {responseShape === 'custom_jsonpath'
                  ? `✓ ${t('moderationProvider.presetCustomJsonPathActive')}`
                  : t('moderationProvider.presetCustomJsonPath')}
              </Button>
            </div>
            {responseShape === 'custom_jsonpath' &&
              !customCategoriesPath.trim() && (
                <p className="mt-2 text-xs text-amber-600">
                  {t('moderationProvider.customJsonPathHint')}
                </p>
              )}
          </FormSection>

          <ApiKeyPanel
            organizationId={organizationId}
            disabled={cannotManage}
          />

          <FormSection
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
          </FormSection>

          <FormSection
            label={t('moderationProvider.categoryMappings')}
            description={t('moderationProvider.categoryMappingsDescription')}
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
                        handleDeleteMapping(mappingEditorIndex);
                      }
                    }
              }
            />
          )}
        </>
      )}
    </PageSection>
  );
}

// ---------------------------------------------------------------------------
// API key panel
// ---------------------------------------------------------------------------

interface ApiKeyPanelProps {
  organizationId: string;
  disabled: boolean;
}

function ApiKeyPanel({ organizationId, disabled }: ApiKeyPanelProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const { data: currentMask, isLoading } =
    useModerationSecretStatus(organizationId);
  const saveSecret = useSaveModerationSecret();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const handleSave = async () => {
    const value = draft.trim();
    if (value.length === 0) return;
    try {
      await saveSecret.mutateAsync({ organizationId, authHeader: value });
      toast({ title: t('moderationProvider.apiKeySaved'), variant: 'success' });
      setEditing(false);
      setDraft('');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t('moderationProvider.saveFailed');
      toast({ title: msg, variant: 'destructive' });
    }
  };

  return (
    <FormSection
      label={t('moderationProvider.apiKey')}
      description={t('moderationProvider.apiKeyDescription', {
        secretPlaceholder: '{{secret}}',
      })}
    >
      {editing ? (
        <div className="flex flex-col gap-2">
          <Input
            type="password"
            value={draft}
            disabled={disabled || saveSecret.isPending}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('moderationProvider.apiKeyPlaceholder')}
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={
                disabled || saveSecret.isPending || draft.trim().length === 0
              }
              onClick={() => void handleSave()}
            >
              {tCommon('actions.save')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={saveSecret.isPending}
              onClick={() => {
                setEditing(false);
                setDraft('');
              }}
            >
              {tCommon('actions.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <code className="text-muted-foreground bg-muted rounded px-2 py-1 text-xs">
            {isLoading
              ? t('moderationProvider.apiKeyLoading')
              : currentMask
                ? currentMask
                : t('moderationProvider.apiKeyNotConfigured')}
          </code>
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            {currentMask
              ? t('moderationProvider.replaceKey')
              : t('moderationProvider.setKey')}
          </Button>
        </div>
      )}
    </FormSection>
  );
}

// ---------------------------------------------------------------------------
// Test connection panel
// ---------------------------------------------------------------------------

interface TestConnectionPanelProps {
  organizationId: string;
  disabled: boolean;
}

interface TestResult {
  ok: boolean;
  kind:
    | 'pass'
    | 'modified'
    | 'flagged'
    | 'blocked'
    | 'step_error'
    | 'not_configured';
  categoryIds?: string[];
  matchCount?: number;
  httpStatus?: number;
  durationMs?: number;
  errorClass?:
    | 'timeout'
    | 'network'
    | 'parse'
    | 'http_4xx'
    | 'http_5xx'
    | 'config'
    | 'unknown';
  circuitOpened?: boolean;
  hint?: string;
}

function TestConnectionPanel({
  organizationId,
  disabled,
}: TestConnectionPanelProps) {
  const { t } = useT('governance');
  const testMutation = useTestModerationProvider();
  const [text, setText] = useState(t('moderationProvider.testDefaultText'));
  const [result, setResult] = useState<TestResult | null>(null);

  const runTest = async () => {
    setResult(null);
    try {
      const r = await testMutation.mutateAsync({
        organizationId,
        orgSlug: 'default',
        text,
      });
      setResult(r);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setResult({
        ok: false,
        kind: 'step_error',
        errorClass: 'unknown',
        hint: message,
      });
    }
  };

  return (
    <FormSection
      label={t('moderationProvider.testConnection')}
      description={t('moderationProvider.testConnectionDescription')}
    >
      <div className="flex flex-col gap-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('moderationProvider.testPlaceholder')}
          rows={3}
          disabled={disabled || testMutation.isPending}
        />
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void runTest()}
            disabled={
              disabled || testMutation.isPending || text.trim().length === 0
            }
          >
            {testMutation.isPending
              ? t('moderationProvider.testing')
              : t('moderationProvider.runTest')}
          </Button>
        </div>
        {result && <TestResultView result={result} />}
      </div>
    </FormSection>
  );
}

function TestResultView({ result }: { result: TestResult }) {
  const { t } = useT('governance');
  // `Alert` supports: 'default' | 'warning' | 'destructive'. A passing test
  // (no category hits) renders as 'default' — neutral, not green.
  const variant: 'default' | 'warning' | 'destructive' =
    result.kind === 'step_error' || result.kind === 'not_configured'
      ? 'destructive'
      : result.kind === 'blocked' ||
          result.kind === 'flagged' ||
          result.kind === 'modified'
        ? 'warning'
        : 'default';
  const title =
    result.kind === 'pass'
      ? t('moderationProvider.testPass')
      : result.kind === 'flagged'
        ? t('moderationProvider.testFlagged')
        : result.kind === 'blocked'
          ? t('moderationProvider.testBlocked')
          : result.kind === 'modified'
            ? t('moderationProvider.testModified')
            : result.kind === 'not_configured'
              ? t('moderationProvider.testNotConfigured')
              : t('moderationProvider.testStepError', {
                  errorClass: result.errorClass ?? 'unknown',
                });
  return (
    <Alert variant={variant} title={title}>
      <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs">
        {result.httpStatus !== undefined && (
          <>
            <dt className="text-muted-foreground">
              {t('moderationProvider.testResultHttpStatus')}
            </dt>
            <dd className="tabular-nums">{result.httpStatus}</dd>
          </>
        )}
        {result.durationMs !== undefined && (
          <>
            <dt className="text-muted-foreground">
              {t('moderationProvider.testResultDuration')}
            </dt>
            <dd className="tabular-nums">
              {t('moderationProvider.testResultDurationValue', {
                ms: result.durationMs,
              })}
            </dd>
          </>
        )}
        {result.categoryIds && result.categoryIds.length > 0 && (
          <>
            <dt className="text-muted-foreground">
              {t('moderationProvider.testResultMatched')}
            </dt>
            <dd>{result.categoryIds.join(', ')}</dd>
          </>
        )}
        {result.matchCount !== undefined && result.matchCount > 0 && (
          <>
            <dt className="text-muted-foreground">
              {t('moderationProvider.testResultMatchCount')}
            </dt>
            <dd className="tabular-nums">{result.matchCount}</dd>
          </>
        )}
        {result.circuitOpened && (
          <>
            <dt className="text-muted-foreground">
              {t('moderationProvider.testResultCircuit')}
            </dt>
            <dd className="text-amber-700">
              {t('moderationProvider.testResultCircuitOpened')}
            </dd>
          </>
        )}
      </dl>
      {result.hint && <p className="mt-2 text-xs">{result.hint}</p>}
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// Endpoint summary + edit dialog
// ---------------------------------------------------------------------------

interface EndpointSummaryProps {
  url: string;
  headersCount: number;
  timeoutMs: string;
  onEdit: () => void;
  disabled: boolean;
}

function EndpointSummary({
  url,
  headersCount,
  timeoutMs,
  onEdit,
  disabled,
}: EndpointSummaryProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  return (
    <div className="border-border flex items-start justify-between gap-4 rounded-lg border p-4">
      <dl className="min-w-0 flex-1 space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-foreground w-36 shrink-0">
            {t('moderationProvider.endpointUrlLabel')}
          </dt>
          <dd className="font-mono text-xs break-all">
            {url || (
              <span className="text-muted-foreground">
                {t('moderationProvider.endpointUrlNotSet')}
              </span>
            )}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground w-36 shrink-0">
            {t('moderationProvider.endpointHeadersLabel')}
          </dt>
          <dd>{headersCount}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground w-36 shrink-0">
            {t('moderationProvider.endpointTimeoutLabel')}
          </dt>
          <dd>
            {t('moderationProvider.endpointTimeoutValue', { ms: timeoutMs })}
          </dd>
        </div>
      </dl>
      <Button
        variant="secondary"
        size="sm"
        icon={Pencil}
        disabled={disabled}
        onClick={onEdit}
      >
        {tCommon('actions.edit')}
      </Button>
    </div>
  );
}

interface EndpointEditDialogProps {
  open: boolean;
  initial: EndpointDraft;
  responseShape: ModerationResponseShape['type'];
  onCancel: () => void;
  onSave: (draft: EndpointDraft) => void;
}

function endpointDraftEquals(a: EndpointDraft, b: EndpointDraft): boolean {
  if (
    a.url !== b.url ||
    a.requestTemplate !== b.requestTemplate ||
    a.timeoutMs !== b.timeoutMs ||
    a.customFlaggedPath !== b.customFlaggedPath ||
    a.customCategoriesPath !== b.customCategoriesPath ||
    a.customCategoryShape !== b.customCategoryShape
  ) {
    return false;
  }
  if (a.headers.length !== b.headers.length) return false;
  for (let i = 0; i < a.headers.length; i += 1) {
    if (
      a.headers[i]?.key !== b.headers[i]?.key ||
      a.headers[i]?.value !== b.headers[i]?.value
    ) {
      return false;
    }
  }
  return true;
}

function EndpointEditDialog({
  open,
  initial,
  responseShape,
  onCancel,
  onSave,
}: EndpointEditDialogProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  const [draft, setDraft] = useState(initial);

  // Reset when dialog reopens with a different initial value.
  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const addHeader = () =>
    setDraft((d) => ({
      ...d,
      headers: [...d.headers, { key: '', value: '' }],
    }));
  const removeHeader = (index: number) =>
    setDraft((d) => ({
      ...d,
      headers: d.headers.filter((_, i) => i !== index),
    }));
  const updateHeader = (index: number, patch: Partial<HeaderRow>) =>
    setDraft((d) => ({
      ...d,
      headers: d.headers.map((h, i) => (i === index ? { ...h, ...patch } : h)),
    }));

  const hasChanges = !endpointDraftEquals(draft, initial);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={t('moderationProvider.editEndpointTitle')}
      description={t('moderationProvider.editEndpointDescription', {
        textPlaceholder: '{{text}}',
        directionPlaceholder: '{{direction}}',
        secretPlaceholder: '{{secret}}',
      })}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {tCommon('actions.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!hasChanges}
            onClick={() => onSave(draft)}
          >
            {tCommon('actions.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormSection
          label={t('moderationProvider.endpointUrlField')}
          description={t('moderationProvider.endpointUrlFieldDescription')}
        >
          <Input
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            placeholder={t('moderationProvider.endpointUrlPlaceholder')}
          />
        </FormSection>

        <FormSection label={t('moderationProvider.headersTitle')}>
          <div className="flex flex-col gap-2">
            {draft.headers.map((header, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  aria-label={t('moderationProvider.headerNameAria')}
                  value={header.key}
                  onChange={(e) => updateHeader(index, { key: e.target.value })}
                  placeholder={t('moderationProvider.headerNamePlaceholder')}
                />
                <Input
                  aria-label={t('moderationProvider.headerValueAria')}
                  value={header.value}
                  onChange={(e) =>
                    updateHeader(index, { value: e.target.value })
                  }
                  placeholder={t('moderationProvider.headerValuePlaceholder', {
                    secretPlaceholder: '{{secret}}',
                  })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('moderationProvider.removeHeaderAria')}
                  onClick={() => removeHeader(index)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={addHeader}
            >
              {t('moderationProvider.addHeader')}
            </Button>
          </div>
        </FormSection>

        <FormSection
          label={t('moderationProvider.requestTemplateLabel')}
          description={t('moderationProvider.requestTemplateDescription', {
            textPlaceholder: '{{text}}',
            directionPlaceholder: '{{direction}}',
          })}
        >
          <Textarea
            value={draft.requestTemplate}
            rows={6}
            className="font-mono text-xs"
            onChange={(e) =>
              setDraft({ ...draft, requestTemplate: e.target.value })
            }
          />
        </FormSection>

        <FormSection label={t('moderationProvider.timeoutLabel')}>
          <Input
            type="number"
            value={draft.timeoutMs}
            onChange={(e) => setDraft({ ...draft, timeoutMs: e.target.value })}
          />
        </FormSection>

        {responseShape === 'custom_jsonpath' && (
          <CustomJsonPathSection
            draft={draft}
            onChange={(patch) => setDraft({ ...draft, ...patch })}
          />
        )}
        {/* Bottom padding so the last field isn't flush with the dialog
            footer — the scrollbar already takes the overflow, this is
            just visual breathing room. */}
        <div className="pb-2" />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Custom JSONPath section
// ---------------------------------------------------------------------------
//
// Two-question flow instead of three separate inputs:
//   1. "What shape does the provider return categories in?" (pick from
//      examples — the JSON format itself is the answer)
//   2. Paste the path to the categories, with the correct JSONPath for
//      THAT shape pre-filled as a placeholder.
//
// "Overall flagged path" is a seldom-needed optional that used to take
// the same visual weight as the required fields. Now it's collapsed
// behind "Show advanced" — providers that don't return a top-level
// boolean (most of them) never have to see it.

function CustomJsonPathSection({
  draft,
  onChange,
}: {
  draft: EndpointDraft;
  onChange: (patch: Partial<EndpointDraft>) => void;
}) {
  const { t } = useT('governance');
  const [showAdvanced, setShowAdvanced] = useState(
    draft.customFlaggedPath.trim().length > 0,
  );
  const sample = SHAPE_SAMPLES[draft.customCategoryShape];
  return (
    <FormSection
      label={t('moderationProvider.parseResponseLabel')}
      description={t('moderationProvider.parseResponseDescription')}
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium">
            {t('moderationProvider.shapeStepTitle')}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('moderationProvider.shapeStepDescription')}
          </p>
          <Select
            className="mt-1.5"
            value={draft.customCategoryShape}
            onValueChange={(v) => {
              if (
                v === 'array' ||
                v === 'record_of_bool' ||
                v === 'record_of_score'
              ) {
                onChange({ customCategoryShape: v });
              }
            }}
            options={[
              {
                value: 'record_of_bool',
                label: `${t('moderationProvider.shapeRecordBool')} — { "hate": true, "violence": false }`,
              },
              {
                value: 'record_of_score',
                label: `${t('moderationProvider.shapeRecordScore')} — { "hate": 0.02, "violence": 0.87 }`,
              },
              {
                value: 'array',
                label: `${t('moderationProvider.shapeArray')} — ["hate", "violence"]`,
              },
            ]}
          />
        </div>

        <div>
          <label className="text-sm font-medium">
            {t('moderationProvider.pathStepTitle')}{' '}
            <span className="text-destructive">
              {t('moderationProvider.pathStepRequired')}
            </span>
          </label>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('moderationProvider.pathStepDescription')}
          </p>
          <Input
            className="mt-1.5 font-mono text-sm"
            value={draft.customCategoriesPath}
            onChange={(e) => onChange({ customCategoriesPath: e.target.value })}
            placeholder={sample.categoriesPath}
          />
          <div className="border-border bg-muted/40 mt-2 rounded-md border p-3">
            <div className="text-muted-foreground mb-1 text-xs">
              {t('moderationProvider.pathExampleTitle')}
            </div>
            <pre className="bg-background overflow-x-auto rounded border p-2 font-mono text-xs">
              {sample.json}
            </pre>
            <div className="text-muted-foreground mt-2 text-xs">
              <code className="text-foreground bg-background rounded px-1 font-mono">
                {sample.categoriesPath}
              </code>{' '}
              — {t('moderationProvider.pathExampleExplanation')}
            </div>
          </div>
        </div>

        {!showAdvanced ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground self-start text-xs underline underline-offset-2"
            onClick={() => setShowAdvanced(true)}
          >
            {t('moderationProvider.showAdvanced')}
          </button>
        ) : (
          <div>
            <label className="text-sm font-medium">
              {t('moderationProvider.flaggedPathLabel')}{' '}
              <span className="text-muted-foreground">
                {t('moderationProvider.flaggedPathOptional')}
              </span>
            </label>
            <p className="text-muted-foreground mt-1 text-xs">
              {t('moderationProvider.flaggedPathDescription')}
            </p>
            <Input
              className="mt-1.5 font-mono text-sm"
              value={draft.customFlaggedPath}
              onChange={(e) => onChange({ customFlaggedPath: e.target.value })}
              placeholder="$.results[0].flagged"
            />
          </div>
        )}
      </div>
    </FormSection>
  );
}

interface ShapeSample {
  json: string;
  categoriesPath: string;
}

const SHAPE_SAMPLES: Record<
  'array' | 'record_of_bool' | 'record_of_score',
  ShapeSample
> = {
  record_of_bool: {
    json: `{
  "results": [
    {
      "flagged": true,
      "categories": {
        "hate": false,
        "violence": true,
        "sexual": false
      }
    }
  ]
}`,
    categoriesPath: '$.results[0].categories',
  },
  record_of_score: {
    json: `{
  "attributeScores": {
    "TOXICITY":   { "summaryScore": { "value": 0.87 } },
    "INSULT":     { "summaryScore": { "value": 0.12 } }
  }
}`,
    categoriesPath: '$.attributeScores.*.summaryScore.value',
  },
  array: {
    json: `{
  "flaggedCategories": ["hate", "violence"]
}`,
    categoriesPath: '$.flaggedCategories',
  },
};

// ---------------------------------------------------------------------------
// Category mappings list + edit dialog
// ---------------------------------------------------------------------------

interface MappingListProps {
  mappings: readonly ModerationCategoryMapping[];
  disabled: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
}

function MappingList({ mappings, disabled, onAdd, onEdit }: MappingListProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  return (
    <div className="flex flex-col gap-2">
      {mappings.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          {t('moderationProvider.mappingsEmpty')}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-left text-xs">
              <th className="py-1 font-medium">
                {t('moderationProvider.mappingColumnProviderCategory')}
              </th>
              <th className="py-1 font-medium">
                {t('moderationProvider.mappingColumnInternalLabel')}
              </th>
              <th className="py-1 font-medium">
                {t('moderationProvider.mappingColumnMode')}
              </th>
              <th className="py-1 font-medium">
                {t('moderationProvider.mappingColumnThreshold')}
              </th>
              <th className="py-1 font-medium">
                {t('moderationProvider.mappingColumnEnabled')}
              </th>
              <th className="py-1 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((mapping, index) => (
              <tr key={index} className="border-border border-t">
                <td className="py-2 font-mono text-xs">
                  {mapping.providerCategory}
                </td>
                <td className="py-2">{mapping.internalLabel}</td>
                <td className="py-2 capitalize">{mapping.mode}</td>
                <td className="py-2">
                  {mapping.scoreThreshold ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-2">
                  {mapping.enabled
                    ? t('moderationProvider.yes')
                    : t('moderationProvider.no')}
                </td>
                <td className="py-2 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Pencil}
                    disabled={disabled}
                    onClick={() => onEdit(index)}
                  >
                    {tCommon('actions.edit')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div>
        <Button
          variant="secondary"
          size="sm"
          icon={Plus}
          disabled={disabled}
          onClick={onAdd}
        >
          {t('moderationProvider.addMapping')}
        </Button>
      </div>
    </div>
  );
}

interface MappingEditDialogProps {
  index: number | 'new';
  initial?: ModerationCategoryMapping;
  onCancel: () => void;
  onSave: (draft: ModerationCategoryMapping) => void;
  onDelete?: () => void;
}

function MappingEditDialog({
  index,
  initial,
  onCancel,
  onSave,
  onDelete,
}: MappingEditDialogProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  const [providerCategory, setProviderCategory] = useState(
    initial?.providerCategory ?? '',
  );
  const [internalLabel, setInternalLabel] = useState(
    initial?.internalLabel ?? '',
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [mode, setMode] = useState<'block' | 'mask' | 'flag'>(
    initial?.mode ?? 'flag',
  );
  const [scoreThresholdText, setScoreThresholdText] = useState(
    initial?.scoreThreshold !== undefined ? String(initial.scoreThreshold) : '',
  );

  const isNew = index === 'new';
  const canSave =
    providerCategory.trim().length > 0 && internalLabel.trim().length > 0;

  // Save only activates when the draft differs from the initial mapping
  // (or, for a new mapping, once the required fields are filled). Treats
  // empty scoreThreshold string as "undefined" to avoid comparing NaN.
  const initialScoreText =
    initial?.scoreThreshold !== undefined ? String(initial.scoreThreshold) : '';
  const hasChanges =
    isNew ||
    providerCategory.trim() !== (initial?.providerCategory ?? '') ||
    internalLabel.trim() !== (initial?.internalLabel ?? '') ||
    enabled !== (initial?.enabled ?? true) ||
    mode !== (initial?.mode ?? 'flag') ||
    scoreThresholdText.trim() !== initialScoreText.trim();

  const handleSave = () => {
    const parsed = scoreThresholdText.trim();
    const scoreThreshold = parsed === '' ? undefined : Number(parsed);
    if (scoreThreshold !== undefined && Number.isNaN(scoreThreshold)) return;
    onSave({
      providerCategory: providerCategory.trim(),
      internalLabel: internalLabel.trim(),
      enabled,
      mode,
      scoreThreshold,
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={
        isNew
          ? t('moderationProvider.addMappingTitle')
          : t('moderationProvider.editMappingTitle')
      }
      description={t('moderationProvider.mappingDialogDescription')}
      footer={
        <>
          {onDelete && (
            <Button variant="destructive" onClick={onDelete}>
              {tCommon('actions.delete')}
            </Button>
          )}
          <Button variant="ghost" onClick={onCancel}>
            {tCommon('actions.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!canSave || !hasChanges}
            onClick={handleSave}
          >
            {tCommon('actions.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormSection
          label={t('moderationProvider.providerCategoryLabel')}
          description={t('moderationProvider.providerCategoryDescription')}
        >
          <Input
            value={providerCategory}
            onChange={(e) => setProviderCategory(e.target.value)}
            placeholder={t('moderationProvider.providerCategoryPlaceholder')}
          />
        </FormSection>

        <FormSection
          label={t('moderationProvider.internalLabelLabel')}
          description={t('moderationProvider.internalLabelDescription')}
        >
          <Input
            value={internalLabel}
            onChange={(e) => setInternalLabel(e.target.value)}
            placeholder={t('moderationProvider.internalLabelPlaceholder')}
          />
        </FormSection>

        <FormSection label={t('moderationProvider.modeLabel')}>
          <Select
            value={mode}
            onValueChange={(v) => {
              if (v === 'block' || v === 'mask' || v === 'flag') setMode(v);
            }}
            options={[
              {
                value: 'block',
                label: t('moderationProvider.modeBlock'),
              },
              {
                value: 'mask',
                label: t('moderationProvider.modeMask'),
              },
              {
                value: 'flag',
                label: t('moderationProvider.modeFlag'),
              },
            ]}
          />
        </FormSection>

        <FormSection
          label={t('moderationProvider.scoreThresholdLabel')}
          description={t('moderationProvider.scoreThresholdDescription')}
        >
          <Input
            type="number"
            step="0.05"
            value={scoreThresholdText}
            onChange={(e) => setScoreThresholdText(e.target.value)}
            placeholder={t('moderationProvider.scoreThresholdPlaceholder')}
          />
        </FormSection>

        <FormSection label={t('moderationProvider.enabled')}>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </FormSection>
      </div>
    </Dialog>
  );
}
