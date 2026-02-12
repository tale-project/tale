import { createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useForm } from 'react-hook-form';

import type { ModelPreset } from '@/lib/shared/schemas/custom_agents';

import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Stack, NarrowContainer } from '@/app/components/ui/layout/layout';
import { AutoSaveIndicator } from '@/app/features/custom-agents/components/auto-save-indicator';
import { useCustomAgentCollection } from '@/app/features/custom-agents/hooks/collections';
import { useUpdateCustomAgent } from '@/app/features/custom-agents/hooks/mutations';
import { useModelPresets } from '@/app/features/custom-agents/hooks/queries';
import { useAutoSave } from '@/app/features/custom-agents/hooks/use-auto-save';
import { useCustomAgentVersion } from '@/app/features/custom-agents/hooks/use-custom-agent-version-context';
import { useT } from '@/lib/i18n/client';
import { FILE_PREPROCESSING_INSTRUCTIONS } from '@/lib/shared/constants/custom-agents';
import { toId } from '@/lib/utils/type-guards';

export const Route = createFileRoute(
  '/dashboard/$id/custom-agents/$agentId/instructions',
)({
  component: InstructionsTab,
});

interface InstructionsFormData {
  systemInstructions: string;
  modelPreset: ModelPreset;
  filePreprocessingEnabled: boolean;
}

const MODEL_PRESET_OPTIONS = ['fast', 'standard', 'advanced'] as const;

function InstructionsTab() {
  const { id: organizationId, agentId } = Route.useParams();
  const { t } = useT('settings');
  const { agent, isReadOnly } = useCustomAgentVersion();
  const customAgentCollection = useCustomAgentCollection(organizationId);
  const updateAgent = useUpdateCustomAgent(customAgentCollection);

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
      await updateAgent({
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
            <div className="bg-background sticky top-[49px] z-40 -mx-4 flex items-center justify-between px-4 md:top-[97px]">
              <Stack gap={1}>
                <h2 className="text-foreground text-base font-semibold">
                  {t('customAgents.form.sectionInstructions')}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {t('customAgents.form.sectionInstructionsDescription')}
                </p>
              </Stack>
              <AutoSaveIndicator status={status} />
            </div>
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

        <section>
          <Stack gap={4}>
            <Stack gap={1}>
              <h2 className="text-foreground text-base font-semibold">
                {t('customAgents.form.sectionModel')}
              </h2>
              <p className="text-muted-foreground text-sm">
                {t('customAgents.form.sectionModelDescription')}
              </p>
            </Stack>
            <Stack gap={3}>
              <Select
                options={modelOptions}
                label={t('customAgents.form.modelPreset')}
                value={form.watch('modelPreset')}
                onValueChange={(val) =>
                  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Select value is constrained to MODEL_PRESET_OPTIONS
                  form.setValue('modelPreset', val as ModelPreset)
                }
                required
                disabled={isReadOnly}
              />
            </Stack>
          </Stack>
        </section>

        <section>
          <Stack gap={4}>
            <Stack gap={1}>
              <h2 className="text-foreground text-base font-semibold">
                {t('customAgents.form.sectionFilePreprocessing')}
              </h2>
              <p className="text-muted-foreground text-sm">
                {t('customAgents.form.sectionFilePreprocessingDescription')}
              </p>
            </Stack>
            <div>
              <Switch
                checked={form.watch('filePreprocessingEnabled')}
                onCheckedChange={(checked) =>
                  form.setValue('filePreprocessingEnabled', checked)
                }
                label={t('customAgents.form.filePreprocessingEnabled')}
                disabled={isReadOnly}
              />
              <p className="text-muted-foreground mt-1.5 ml-10 text-xs">
                {t('customAgents.form.filePreprocessingEnabledHelp')}
              </p>
            </div>
            {form.watch('filePreprocessingEnabled') && (
              <div>
                <p className="text-muted-foreground mb-2 text-xs font-medium">
                  {t('customAgents.form.filePreprocessingInjectedPrompt')}
                </p>
                <pre className="bg-muted text-muted-foreground rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">
                  {FILE_PREPROCESSING_INSTRUCTIONS}
                </pre>
              </div>
            )}
          </Stack>
        </section>
      </Stack>
    </NarrowContainer>
  );
}
