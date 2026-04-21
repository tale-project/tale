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

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

const OPENAI_MODERATION_EXAMPLE = {
  url: 'https://api.openai.com/v1/moderations',
  headers: [
    { key: 'Authorization', value: 'Bearer {{secret}}' },
    { key: 'Content-Type', value: 'application/json' },
  ],
  requestTemplate: '{"input": {{text}}, "model": "omni-moderation-latest"}',
  allowedHosts: ['api.openai.com'],
};

interface HeaderRow {
  key: string;
  value: string;
}

type EndpointDraft = {
  url: string;
  allowedHostsText: string;
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
  const [allowedHostsText, setAllowedHostsText] = useState('');
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
      setAllowedHostsText((config.endpoint?.allowedHosts ?? []).join('\n'));
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
      allowedHostsText?: string;
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

      const allowedHosts = (overrides.allowedHostsText ?? allowedHostsText)
        .split(/\r?\n/)
        .map((h) => h.trim())
        .filter((h) => h.length > 0);

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
          allowedHosts: allowedHosts.length > 0 ? allowedHosts : [resolvedUrl],
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
        secretFile: 'moderation.secrets.json',
        configVersion: 1,
      };
    },
    [
      enabled,
      appliesToInput,
      appliesToOutput,
      url,
      allowedHostsText,
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
      void saveWith(buildConfig({ responseShape: value }));
    },
    [buildConfig, saveWith],
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

  const handleApplyOpenAiExample = useCallback(() => {
    setUrl(OPENAI_MODERATION_EXAMPLE.url);
    setHeaders(OPENAI_MODERATION_EXAMPLE.headers);
    setRequestTemplate(OPENAI_MODERATION_EXAMPLE.requestTemplate);
    setAllowedHostsText(OPENAI_MODERATION_EXAMPLE.allowedHosts.join('\n'));
    setResponseShape('openai_moderation');
    void saveWith(
      buildConfig({
        url: OPENAI_MODERATION_EXAMPLE.url,
        headers: OPENAI_MODERATION_EXAMPLE.headers,
        requestTemplate: OPENAI_MODERATION_EXAMPLE.requestTemplate,
        allowedHostsText: OPENAI_MODERATION_EXAMPLE.allowedHosts.join('\n'),
        responseShape: 'openai_moderation',
      }),
    );
  }, [buildConfig, saveWith]);

  const handleSaveEndpoint = useCallback(
    (draft: EndpointDraft) => {
      setUrl(draft.url);
      setAllowedHostsText(draft.allowedHostsText);
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
          allowedHostsText: draft.allowedHostsText,
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
    allowedHostsText,
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
      description="Send chat messages to an external classifier (OpenAI Moderation, Azure Content Safety, Perspective, or any custom HTTPS endpoint). The `authHeader` secret lives in moderation.secrets.json (SOPS-encrypted) — reference it in any header value as `{{secret}}`."
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

      <FormSection label="Response shape">
        <Select
          value={responseShape}
          disabled={cannotManage}
          onValueChange={(v) => {
            if (
              v === 'openai_moderation' ||
              v === 'azure_content_safety' ||
              v === 'perspective' ||
              v === 'custom_jsonpath'
            ) {
              handleResponseShapeChange(v);
            }
          }}
          options={[
            { value: 'openai_moderation', label: 'OpenAI Moderation' },
            { value: 'azure_content_safety', label: 'Azure Content Safety' },
            { value: 'perspective', label: 'Perspective API' },
            { value: 'custom_jsonpath', label: 'Custom JSONPath' },
          ]}
        />
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
        label="Preset"
        description="Pre-fills URL, headers, and request template for a known provider. You can still edit individual fields after applying."
      >
        <Button
          variant="secondary"
          size="sm"
          disabled={cannotManage}
          onClick={handleApplyOpenAiExample}
        >
          Use OpenAI Moderation
        </Button>
      </FormSection>

      <FormSection
        label="Endpoint"
        description="HTTPS URL, headers, request template, and timeout for the external call."
      >
        <EndpointSummary
          url={url}
          allowedHostsCount={
            allowedHostsText.split(/\r?\n/).filter((h) => h.trim()).length
          }
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
        <MappingList
          mappings={mappings}
          disabled={cannotManage}
          onAdd={() => setMappingEditorIndex('new')}
          onEdit={(index) => setMappingEditorIndex(index)}
        />
      </FormSection>

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
// Endpoint summary + edit dialog
// ---------------------------------------------------------------------------

interface EndpointSummaryProps {
  url: string;
  allowedHostsCount: number;
  headersCount: number;
  timeoutMs: string;
  onEdit: () => void;
  disabled: boolean;
}

function EndpointSummary({
  url,
  allowedHostsCount,
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
          <dt className="text-muted-foreground w-36 shrink-0">Allowed hosts</dt>
          <dd>{allowedHostsCount}</dd>
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
    a.allowedHostsText !== b.allowedHostsText ||
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
        <FormSection label="Endpoint URL (HTTPS required)">
          <Input
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            placeholder="https://api.example.com/v1/moderate"
          />
        </FormSection>

        <FormSection
          label="Allowed hosts"
          description="One hostname per line. SSRF defense — the request is rejected if the URL's host isn't listed."
        >
          <Textarea
            value={draft.allowedHostsText}
            rows={3}
            onChange={(e) =>
              setDraft({ ...draft, allowedHostsText: e.target.value })
            }
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
          <FormSection
            label="Custom JSONPath"
            description="Used when Response shape is set to Custom JSONPath. Adjust the Response shape selector on the main page to toggle this section."
          >
            <div className="flex flex-col gap-2">
              <Input
                value={draft.customFlaggedPath}
                onChange={(e) =>
                  setDraft({ ...draft, customFlaggedPath: e.target.value })
                }
                placeholder="$.flagged  (optional)"
              />
              <Input
                value={draft.customCategoriesPath}
                onChange={(e) =>
                  setDraft({ ...draft, customCategoriesPath: e.target.value })
                }
                placeholder="$.categories  (required)"
              />
              <Select
                value={draft.customCategoryShape}
                onValueChange={(v) => {
                  if (
                    v === 'array' ||
                    v === 'record_of_bool' ||
                    v === 'record_of_score'
                  ) {
                    setDraft({ ...draft, customCategoryShape: v });
                  }
                }}
                options={[
                  { value: 'array', label: 'Array of category strings' },
                  {
                    value: 'record_of_bool',
                    label: 'Record<category, boolean>',
                  },
                  {
                    value: 'record_of_score',
                    label: 'Record<category, number>',
                  },
                ]}
              />
            </div>
          </FormSection>
        )}
      </div>
    </Dialog>
  );
}

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
