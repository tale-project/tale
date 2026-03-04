import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';

import type { ModelPreset } from '@/lib/shared/schemas/custom_agents';

import { ContentArea } from '@/app/components/layout/content-area';
import { CodeBlock } from '@/app/components/ui/data-display/code-block';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { CollapsibleDetails } from '@/app/components/ui/navigation/collapsible-details';
import { AutoSaveIndicator } from '@/app/features/custom-agents/components/auto-save-indicator';
import { useUpdateCustomAgent } from '@/app/features/custom-agents/hooks/mutations';
import { useModelPresets } from '@/app/features/custom-agents/hooks/queries';
import { useAutoSave } from '@/app/features/custom-agents/hooks/use-auto-save';
import { useCustomAgentVersion } from '@/app/features/custom-agents/hooks/use-custom-agent-version-context';
import { api } from '@/convex/_generated/api';
import { SUPPORTED_TEMPLATE_VARIABLES } from '@/convex/lib/agent_response/resolve_template_variables';
import { STRUCTURED_RESPONSE_INSTRUCTIONS } from '@/convex/lib/agent_response/structured_response_instructions';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { FILE_PREPROCESSING_INSTRUCTIONS } from '@/lib/shared/constants/custom-agents';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/custom-agents/$agentId/instructions',
)({
  head: () => ({
    meta: seo('agentInstructions'),
  }),
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.custom_agents.queries.getModelPresets, {}),
    );
  },
  component: InstructionsTab,
});

interface InstructionsFormData {
  systemInstructions: string;
  modelId: string;
  filePreprocessingEnabled: boolean;
  structuredResponsesEnabled: boolean;
}

const PRESET_KEYS = ['fast', 'standard', 'advanced'] as const;

function derivePresetFromModelId(
  modelId: string,
  presets: Record<string, string[]>,
): ModelPreset {
  for (const key of PRESET_KEYS) {
    if (presets[key]?.includes(modelId)) return key;
  }
  return 'standard';
}

function getDefaultModelId(
  preset: string,
  presets: Record<string, string[]> | undefined,
): string {
  return presets?.[preset]?.[0] ?? '';
}

function InstructionsTab() {
  const { agentId } = Route.useParams();
  const { t } = useT('settings');
  const { agent, isReadOnly } = useCustomAgentVersion();
  const updateAgent = useUpdateCustomAgent();

  const { data: modelPresets } = useModelPresets();

  const modelOptions = useMemo(() => {
    if (!modelPresets) return [];
    const options: { value: string; label: string }[] = [];
    for (const key of PRESET_KEYS) {
      const models = modelPresets[key] ?? [];
      const presetLabel = t(`customAgents.form.modelPresets.${key}`);
      for (const model of models) {
        options.push({
          value: model,
          label: `${model} (${presetLabel})`,
        });
      }
    }
    return options;
  }, [modelPresets, t]);

  const initialModelId =
    agent?.modelId ??
    getDefaultModelId(agent?.modelPreset ?? 'standard', modelPresets);

  const form = useForm<InstructionsFormData>({
    values: agent
      ? {
          systemInstructions: agent.systemInstructions,
          modelId: initialModelId,
          filePreprocessingEnabled: agent.filePreprocessingEnabled ?? false,
          structuredResponsesEnabled: agent.structuredResponsesEnabled ?? true,
        }
      : undefined,
  });

  const formValues = form.watch();

  const handleSave = useCallback(
    async (data: InstructionsFormData) => {
      const modelPreset = modelPresets
        ? derivePresetFromModelId(data.modelId, modelPresets)
        : 'standard';

      await updateAgent.mutateAsync({
        customAgentId: toId<'customAgents'>(agentId),
        systemInstructions: data.systemInstructions,
        modelPreset,
        modelId: data.modelId,
        filePreprocessingEnabled: data.filePreprocessingEnabled,
        structuredResponsesEnabled: data.structuredResponsesEnabled,
      });
    },
    [agentId, updateAgent, modelPresets],
  );

  const { status, save } = useAutoSave({
    data: formValues,
    onSave: handleSave,
    enabled: !isReadOnly,
    mode: 'manual',
  });

  const systemInstructionsField = form.register('systemInstructions', {
    required: t('customAgents.form.systemInstructionsRequired'),
  });

  return (
    <ContentArea variant="narrow" gap={6}>
      <PageSection
        title={t('customAgents.form.sectionInstructions')}
        description={t('customAgents.form.sectionInstructionsDescription')}
        action={<AutoSaveIndicator status={status} />}
        gap={4}
      >
        <Textarea
          id="systemInstructions"
          label={t('customAgents.form.systemInstructions')}
          placeholder={t('customAgents.form.systemInstructionsPlaceholder')}
          {...systemInstructionsField}
          onBlur={(e) => {
            void systemInstructionsField.onBlur(e);
            void form.handleSubmit((data) => save(data))();
          }}
          required
          rows={8}
          className="font-mono text-sm"
          disabled={isReadOnly}
          errorMessage={form.formState.errors.systemInstructions?.message}
        />
        <CollapsibleDetails
          variant="compact"
          summary={t('customAgents.form.templateVariablesLabel')}
        >
          <p className="text-muted-foreground mt-1 mb-2 text-xs">
            {t('customAgents.form.templateVariablesDescription')}
          </p>
          <ul className="text-muted-foreground space-y-0.5 font-mono text-xs">
            {SUPPORTED_TEMPLATE_VARIABLES.map((v) => (
              <li key={v.variable}>
                <code className="bg-muted rounded px-1">{v.variable}</code>{' '}
                <span className="font-sans">&mdash; {v.description}</span>
              </li>
            ))}
          </ul>
        </CollapsibleDetails>
      </PageSection>

      <PageSection
        title={t('customAgents.form.sectionModel')}
        description={t('customAgents.form.sectionModelDescription')}
      >
        <Select
          options={modelOptions}
          label={t('customAgents.form.model')}
          value={formValues.modelId}
          onValueChange={(val) => {
            form.setValue('modelId', val);
            void save({
              ...form.getValues(),
              modelId: val,
            });
          }}
          required
          disabled={isReadOnly}
        />
      </PageSection>

      <PageSection
        title={t('customAgents.form.sectionFilePreprocessing')}
        description={t('customAgents.form.sectionFilePreprocessingDescription')}
      >
        <Switch
          checked={formValues.filePreprocessingEnabled}
          onCheckedChange={(checked) => {
            form.setValue('filePreprocessingEnabled', checked);
            void save({
              ...form.getValues(),
              filePreprocessingEnabled: checked,
            });
          }}
          label={t('customAgents.form.filePreprocessingEnabled')}
          description={t('customAgents.form.filePreprocessingEnabledHelp')}
          disabled={isReadOnly}
        />
        {formValues.filePreprocessingEnabled && (
          <CodeBlock
            label={t('customAgents.form.filePreprocessingInjectedPrompt')}
            copyValue={FILE_PREPROCESSING_INSTRUCTIONS}
            copyLabel={t('customAgents.form.copyPrompt')}
          >
            {FILE_PREPROCESSING_INSTRUCTIONS}
          </CodeBlock>
        )}
      </PageSection>

      <PageSection
        title={t('customAgents.form.sectionStructuredResponses')}
        description={t(
          'customAgents.form.sectionStructuredResponsesDescription',
        )}
      >
        <Switch
          checked={formValues.structuredResponsesEnabled}
          onCheckedChange={(checked) => {
            form.setValue('structuredResponsesEnabled', checked);
            void save({
              ...form.getValues(),
              structuredResponsesEnabled: checked,
            });
          }}
          label={t('customAgents.form.structuredResponsesEnabled')}
          description={t('customAgents.form.structuredResponsesEnabledHelp')}
          disabled={isReadOnly}
        />
        {formValues.structuredResponsesEnabled && (
          <CodeBlock
            label={t('customAgents.form.structuredResponsesInjectedPrompt')}
            copyValue={STRUCTURED_RESPONSE_INSTRUCTIONS}
            copyLabel={t('customAgents.form.copyPrompt')}
          >
            {STRUCTURED_RESPONSE_INSTRUCTIONS}
          </CodeBlock>
        )}
      </PageSection>
    </ContentArea>
  );
}
