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
import type {
  ModerationCategoryMapping,
  ModerationProviderConfig,
  ModerationResponseShape,
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
  label: string;
  note?: string;
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
    label: 'Use OpenAI Moderation',
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
    label: 'Use Azure Content Safety',
    note: 'Replace the subdomain with your own Azure resource name.',
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
    label: 'Use Perspective API',
    note: 'Perspective authenticates via a URL query parameter, not a header. After applying the preset, open Endpoint and append ?key=YOUR_PERSPECTIVE_KEY to the URL. (The encrypted API-key field below is not used by Perspective.)',
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

interface ModerationProviderConfigProps {
  organizationId: string;
}

export function ModerationProviderConfigView({
  organizationId,
}: ModerationProviderConfigProps) {
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
    const config = policy.config as ModerationProviderConfig | undefined;
    if (config) {
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
        toast({ title: 'Moderation provider saved', variant: 'success' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Save failed';
        toast({ title: message, variant: 'destructive' });
      }
    },
    [upsertMutation, organizationId, toast],
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

      if (preset.note) {
        toast({
          title: 'Preset applied',
          description: preset.note,
        });
      } else if (seededMappings !== mappings) {
        toast({
          title: 'Preset applied',
          description: `Added ${preset.defaultMappings.length} default category mappings (all in flag mode — tune them below).`,
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
    [buildConfig, mappings, saveWith, toast],
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
      <PageSection title="Moderation provider">
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
      title="Moderation provider"
      description="Send chat messages to an external classifier (OpenAI Moderation, Azure Content Safety, Perspective, or any custom HTTPS endpoint). Paste the API key in the 'API key' section below — it's AES-encrypted server-side — and reference it in any header value as `{{secret}}`."
    >
      {cannotManage && (
        <Alert
          variant="warning"
          description="You need admin permissions to configure the moderation provider."
        />
      )}

      <FormSection label="Enabled">
        <Switch
          checked={enabled}
          disabled={cannotManage}
          onCheckedChange={handleToggleEnabled}
        />
      </FormSection>

      <FormSection label="Apply to">
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={appliesToInput}
              disabled={cannotManage}
              onChange={(e) => handleAppliesToInput(e.target.checked)}
            />
            <span>User input</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={appliesToOutput}
              disabled={cannotManage}
              onChange={(e) => handleAppliesToOutput(e.target.checked)}
            />
            <span>Model output</span>
          </label>
        </div>
      </FormSection>

      <FormSection
        label="Fail behavior"
        description="What to do when the provider times out, errors, or the circuit breaker is open. Input default is fail-open (let the message through); output default is fail-closed (block the response) since unreviewed model output has higher liability."
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-muted-foreground mb-1 text-xs">Input</div>
            <Select
              value={failInput}
              disabled={cannotManage}
              onValueChange={(v) => {
                if (v === 'open' || v === 'closed') handleFailInputChange(v);
              }}
              options={[
                { value: 'open', label: 'Fail open (pass)' },
                { value: 'closed', label: 'Fail closed (block)' },
              ]}
            />
          </div>
          <div>
            <div className="text-muted-foreground mb-1 text-xs">Output</div>
            <Select
              value={failOutput}
              disabled={cannotManage}
              onValueChange={(v) => {
                if (v === 'open' || v === 'closed') handleFailOutputChange(v);
              }}
              options={[
                { value: 'open', label: 'Fail open (pass)' },
                { value: 'closed', label: 'Fail closed (block)' },
              ]}
            />
          </div>
        </div>
      </FormSection>

      <FormSection
        label="Provider"
        description="Pick a built-in preset — the URL, headers, request template, and response parser are filled in for you. The API key itself is entered (and encrypted) in the API key section below, never in the policy config. Pick Custom JSONPath for any other HTTPS moderation API you want to plug in."
      >
        <div className="flex flex-wrap gap-2">
          {MODERATION_PRESETS.map((preset) => {
            const active = responseShape === preset.id;
            return (
              <Button
                key={preset.id}
                variant={active ? 'primary' : 'secondary'}
                size="sm"
                disabled={cannotManage}
                onClick={() => handleApplyPreset(preset)}
              >
                {active
                  ? `✓ ${preset.label.replace(/^Use /, '')}`
                  : preset.label}
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
              ? '✓ Custom JSONPath'
              : 'Custom JSONPath'}
          </Button>
        </div>
        {responseShape === 'custom_jsonpath' &&
          !customCategoriesPath.trim() && (
            <p className="mt-2 text-xs text-amber-600">
              Open <span className="font-medium">Endpoint</span> below, fill in
              your HTTPS URL, request body template, and the JSONPath for
              categories. The switch won&rsquo;t persist until those fields are
              set.
            </p>
          )}
      </FormSection>

      <ApiKeyPanel organizationId={organizationId} disabled={cannotManage} />

      <FormSection
        label="Endpoint"
        description="HTTPS URL, headers, request template, and timeout for the external call."
      >
        <EndpointSummary
          url={url}
          headersCount={headers.filter((h) => h.key.trim().length > 0).length}
          timeoutMs={timeoutMs}
          onEdit={() => setEndpointDialogOpen(true)}
          disabled={cannotManage}
        />
      </FormSection>

      <FormSection
        label="Category mappings"
        description="Map provider categories (e.g. OpenAI's `hate/threatening`) to an internal label, enforcement mode, and optional score threshold. Block wins over mask wins over flag."
      >
        {enabled && mappings.length === 0 && (
          <Alert
            variant="warning"
            description="No category mappings configured. The provider is being called on every message but nothing will ever be flagged, masked, or blocked — only mapped categories produce events. Add at least one mapping below, or re-apply a preset to seed defaults."
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
        disabled={cannotManage || !enabled}
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
      toast({ title: 'API key saved', variant: 'success' });
      setEditing(false);
      setDraft('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast({ title: msg, variant: 'destructive' });
    }
  };

  return (
    <FormSection
      label="API key"
      description="Pasted here, encrypted with AES-256-GCM on the server, and stored in governanceSecrets. The plaintext value replaces {{secret}} in your endpoint headers at request time. Use the full header value for Authorization-style headers (e.g. 'Bearer sk-…'); raw key for Azure's Ocp-Apim-Subscription-Key."
    >
      {editing ? (
        <div className="flex flex-col gap-2">
          <Input
            type="password"
            value={draft}
            disabled={disabled || saveSecret.isPending}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Bearer sk-... or raw API key"
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
              Save
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
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <code className="text-muted-foreground bg-muted rounded px-2 py-1 text-xs">
            {isLoading
              ? 'Loading…'
              : currentMask
                ? currentMask
                : 'Not configured'}
          </code>
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            {currentMask ? 'Replace' : 'Set key'}
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
  const testMutation = useTestModerationProvider();
  const [text, setText] = useState('I want to kill everyone in this building');
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
      label="Test connection"
      description="Send a sample message through the real provider path. Verifies the API key, endpoint URL, request template, response parser, and category mappings in one round-trip. No chat message is saved — this call bypasses the thread and audit pipeline."
    >
      <div className="flex flex-col gap-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a sample message to send through the provider…"
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
            {testMutation.isPending ? 'Testing…' : 'Run test'}
          </Button>
        </div>
        {result && <TestResultView result={result} />}
      </div>
    </FormSection>
  );
}

function TestResultView({ result }: { result: TestResult }) {
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
      ? 'Call succeeded — no categories matched'
      : result.kind === 'flagged'
        ? 'Call succeeded — flagged'
        : result.kind === 'blocked'
          ? 'Call succeeded — would block'
          : result.kind === 'modified'
            ? 'Call succeeded — would mask'
            : result.kind === 'not_configured'
              ? 'Not configured'
              : `Step error (${result.errorClass ?? 'unknown'})`;
  return (
    <Alert variant={variant} title={title}>
      <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs">
        {result.httpStatus !== undefined && (
          <>
            <dt className="text-muted-foreground">HTTP status</dt>
            <dd className="tabular-nums">{result.httpStatus}</dd>
          </>
        )}
        {result.durationMs !== undefined && (
          <>
            <dt className="text-muted-foreground">Duration</dt>
            <dd className="tabular-nums">{result.durationMs} ms</dd>
          </>
        )}
        {result.categoryIds && result.categoryIds.length > 0 && (
          <>
            <dt className="text-muted-foreground">Matched</dt>
            <dd>{result.categoryIds.join(', ')}</dd>
          </>
        )}
        {result.matchCount !== undefined && result.matchCount > 0 && (
          <>
            <dt className="text-muted-foreground">Match count</dt>
            <dd className="tabular-nums">{result.matchCount}</dd>
          </>
        )}
        {result.circuitOpened && (
          <>
            <dt className="text-muted-foreground">Circuit</dt>
            <dd className="text-amber-700">Opened by this failure</dd>
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
  return (
    <div className="border-border flex items-start justify-between gap-4 rounded-lg border p-4">
      <dl className="min-w-0 flex-1 space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-foreground w-36 shrink-0">URL</dt>
          <dd className="font-mono text-xs break-all">
            {url || <span className="text-muted-foreground">Not set</span>}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground w-36 shrink-0">Headers</dt>
          <dd>{headersCount}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground w-36 shrink-0">Timeout</dt>
          <dd>{timeoutMs} ms</dd>
        </div>
      </dl>
      <Button
        variant="secondary"
        size="sm"
        icon={Pencil}
        disabled={disabled}
        onClick={onEdit}
      >
        Edit
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
  const [draft, setDraft] = useState<EndpointDraft>(initial);

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
      title="Edit endpoint"
      description="URL, headers, and request template are validated server-side. {{text}} and {{direction}} placeholders are JSON-safe; {{secret}} is only allowed in header values."
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!hasChanges}
            onClick={() => onSave(draft)}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormSection
          label="Endpoint URL"
          description="Full HTTPS URL of the moderation API (HTTP allowed for internal / localhost mocks). Only this host is contacted — redirects to other hosts are rejected for SSRF safety."
        >
          <Input
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            placeholder="https://api.example.com/v1/moderate"
          />
        </FormSection>

        <FormSection label="Headers">
          <div className="flex flex-col gap-2">
            {draft.headers.map((header, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  aria-label="Header name"
                  value={header.key}
                  onChange={(e) => updateHeader(index, { key: e.target.value })}
                  placeholder="Authorization"
                />
                <Input
                  aria-label="Header value"
                  value={header.value}
                  onChange={(e) =>
                    updateHeader(index, { value: e.target.value })
                  }
                  placeholder="Bearer {{secret}}"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Remove header"
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
              Add header
            </Button>
          </div>
        </FormSection>

        <FormSection
          label="Request body template"
          description="JSON with {{text}} and optional {{direction}} placeholders. Substitution is JSON-safe; secrets are NOT permitted in the body, only in headers."
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

        <FormSection label="Timeout (ms)">
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
  const [showAdvanced, setShowAdvanced] = useState(
    draft.customFlaggedPath.trim().length > 0,
  );
  const sample = SHAPE_SAMPLES[draft.customCategoryShape];
  return (
    <FormSection
      label="Parse provider response"
      description={
        <>
          Tell us how the provider&rsquo;s JSON response looks so we can pull
          out the flagged categories. If you&rsquo;re not sure, run the provider
          once in a terminal (curl) and paste the response shape into your picks
          below.
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium">
            1. Pick the response shape
          </label>
          <p className="text-muted-foreground mt-1 text-xs">
            Which format does the provider use for its category flags?
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
                label:
                  'Object of booleans — { "hate": true, "violence": false }',
              },
              {
                value: 'record_of_score',
                label: 'Object of scores — { "hate": 0.02, "violence": 0.87 }',
              },
              {
                value: 'array',
                label: 'Array of names — ["hate", "violence"]',
              },
            ]}
          />
        </div>

        <div>
          <label className="text-sm font-medium">
            2. Path to the categories{' '}
            <span className="text-destructive">*required</span>
          </label>
          <p className="text-muted-foreground mt-1 text-xs">
            Where the shape above lives inside the response. A dollar sign is
            the root; dots traverse objects; numbers in brackets index arrays.
          </p>
          <Input
            className="mt-1.5 font-mono text-sm"
            value={draft.customCategoriesPath}
            onChange={(e) => onChange({ customCategoriesPath: e.target.value })}
            placeholder={sample.categoriesPath}
          />
          <div className="border-border bg-muted/40 mt-2 rounded-md border p-3">
            <div className="text-muted-foreground mb-1 text-xs">
              Example response body this path matches:
            </div>
            <pre className="bg-background overflow-x-auto rounded border p-2 font-mono text-xs">
              {sample.json}
            </pre>
            <div className="text-muted-foreground mt-2 text-xs">
              The path{' '}
              <code className="text-foreground bg-background rounded px-1 font-mono">
                {sample.categoriesPath}
              </code>{' '}
              picks out the bold part.
            </div>
          </div>
        </div>

        {!showAdvanced ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground self-start text-xs underline underline-offset-2"
            onClick={() => setShowAdvanced(true)}
          >
            Show advanced (overall flagged path)
          </button>
        ) : (
          <div>
            <label className="text-sm font-medium">
              Overall flagged path{' '}
              <span className="text-muted-foreground">(optional)</span>
            </label>
            <p className="text-muted-foreground mt-1 text-xs">
              Some providers also return a single top-level boolean — e.g.
              OpenAI&rsquo;s{' '}
              <code className="text-foreground font-mono">
                $.results[0].flagged
              </code>
              . If set, <code className="font-mono">false</code> here
              short-circuits the category check and the message passes. Leave
              empty for providers that don&rsquo;t have this field.
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
  return (
    <div className="flex flex-col gap-2">
      {mappings.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          No category mappings configured. Add one to enforce this provider's
          verdicts.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-left text-xs">
              <th className="py-1 font-medium">Provider category</th>
              <th className="py-1 font-medium">Internal label</th>
              <th className="py-1 font-medium">Mode</th>
              <th className="py-1 font-medium">Threshold</th>
              <th className="py-1 font-medium">Enabled</th>
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
                <td className="py-2">{mapping.enabled ? 'Yes' : 'No'}</td>
                <td className="py-2 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Pencil}
                    disabled={disabled}
                    onClick={() => onEdit(index)}
                  >
                    Edit
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
          Add category mapping
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
      title={isNew ? 'Add category mapping' : 'Edit category mapping'}
      description="Block wins over mask wins over flag when multiple mappings fire."
      footer={
        <>
          {onDelete && (
            <Button variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSave || !hasChanges}
            onClick={handleSave}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormSection
          label="Provider category"
          description="The exact category key the provider returns (e.g. `hate`, `hate/threatening`, `violence`)."
        >
          <Input
            value={providerCategory}
            onChange={(e) => setProviderCategory(e.target.value)}
            placeholder="hate"
          />
        </FormSection>

        <FormSection
          label="Internal label"
          description="Human-readable name shown in the audit log and dashboards."
        >
          <Input
            value={internalLabel}
            onChange={(e) => setInternalLabel(e.target.value)}
            placeholder="Hate speech"
          />
        </FormSection>

        <FormSection label="Mode">
          <Select
            value={mode}
            onValueChange={(v) => {
              if (v === 'block' || v === 'mask' || v === 'flag') setMode(v);
            }}
            options={[
              { value: 'block', label: 'Block' },
              { value: 'mask', label: 'Mask (flag-equivalent)' },
              { value: 'flag', label: 'Flag' },
            ]}
          />
        </FormSection>

        <FormSection
          label="Score threshold"
          description="Optional. When the provider returns scores, the mapping only fires when the category's score is at or above this value."
        >
          <Input
            type="number"
            step="0.05"
            value={scoreThresholdText}
            onChange={(e) => setScoreThresholdText(e.target.value)}
            placeholder="0.5"
          />
        </FormSection>

        <FormSection label="Enabled">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </FormSection>
      </div>
    </Dialog>
  );
}
