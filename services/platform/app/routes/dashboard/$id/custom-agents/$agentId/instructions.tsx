import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useForm } from 'react-hook-form';

import type { ModelPreset } from '@/lib/shared/schemas/custom_agents';

import { CodeBlock } from '@/app/components/ui/data-display/code-block';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Stack, NarrowContainer } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';
import { AutoSaveIndicator } from '@/app/features/custom-agents/components/auto-save-indicator';
import { useUpdateCustomAgent } from '@/app/features/custom-agents/hooks/mutations';
import { useModelPresets } from '@/app/features/custom-agents/hooks/queries';
import { useAutoSave } from '@/app/features/custom-agents/hooks/use-auto-save';
import { useCustomAgentVersion } from '@/app/features/custom-agents/hooks/use-custom-agent-version-context';
import { api } from '@/convex/_generated/api';
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
  modelPreset: ModelPreset;
  filePreprocessingEnabled: boolean;
}

const MODEL_PRESET_OPTIONS = ['fast', 'standard', 'advanced'] as const;

function InstructionsTab() {
  const { agentId } = Route.useParams();
  const { t } = useT('settings');
  const { agent, isReadOnly } = useCustomAgentVersion();
  const updateAgent = useUpdateCustomAgent();

  const { data: modelPresets } = useModelPresets();

  const modelOptions = MODEL_PRESET_OPTIONS.map((preset) => {
    const presetLabel = t(`customAgents.form.modelPresets.${preset}`);
    const modelName = modelPresets?.[preset];
    return {
      value: preset,
      label: modelName ? `${presetLabel} (${modelName})` : presetLabel,
    };
  });

  const form = useForm<InstructionsFormData>({
    values: agent
      ? {
          systemInstructions: agent.systemInstructions,
          modelPreset: agent.modelPreset,
          filePreprocessingEnabled: agent.filePreprocessingEnabled ?? false,
        }
      : undefined,
  });

  const formValues = form.watch();

  const handleSave = useCallback(
    async (data: InstructionsFormData) => {
      await updateAgent.mutateAsync({
        customAgentId: toId<'customAgents'>(agentId),
        systemInstructions: data.systemInstructions,
        modelPreset: data.modelPreset,
        filePreprocessingEnabled: data.filePreprocessingEnabled,
      });
    },
    [agentId, updateAgent],
  );

  const { status } = useAutoSave({
    data: formValues,
    onSave: handleSave,
    enabled: !isReadOnly,
  });

  return (
    <NarrowContainer className="py-4">
      <Stack gap={6}>
        <section>
          <Stack gap={4}>
            <StickySectionHeader
              title={t('customAgents.form.sectionInstructions')}
              description={t(
                'customAgents.form.sectionInstructionsDescription',
              )}
              action={<AutoSaveIndicator status={status} />}
            />
            <Textarea
              id="systemInstructions"
              label={t('customAgents.form.systemInstructions')}
              placeholder={t('customAgents.form.systemInstructionsPlaceholder')}
              {...form.register('systemInstructions', { required: true })}
              required
              rows={8}
              className="font-mono text-sm"
              disabled={isReadOnly}
              errorMessage={form.formState.errors.systemInstructions?.message}
            />
          </Stack>
        </section>

        <PageSection
          title={t('customAgents.form.sectionModel')}
          description={t('customAgents.form.sectionModelDescription')}
        >
          <Stack gap={3}>
            <Select
              options={modelOptions}
              label={t('customAgents.form.modelPreset')}
              value={formValues.modelPreset}
              onValueChange={(val) =>
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Select value is constrained to MODEL_PRESET_OPTIONS
                form.setValue('modelPreset', val as ModelPreset)
              }
              required
              disabled={isReadOnly}
            />
          </Stack>
        </PageSection>

        <PageSection
          title={t('customAgents.form.sectionFilePreprocessing')}
          description={t(
            'customAgents.form.sectionFilePreprocessingDescription',
          )}
        >
          <Switch
            checked={formValues.filePreprocessingEnabled}
            onCheckedChange={(checked) =>
              form.setValue('filePreprocessingEnabled', checked)
            }
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
      </Stack>
    </NarrowContainer>
  );
}
