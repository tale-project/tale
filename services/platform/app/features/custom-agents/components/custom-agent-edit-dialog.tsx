'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Stack } from '@/app/components/ui/layout/layout';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { useUpdateCustomAgent } from '../hooks/use-custom-agent-mutations';
import { CustomAgentFormFields } from './custom-agent-form-fields';
import { createCustomAgentSchema, type CreateCustomAgent } from '@/lib/shared/schemas/custom_agents';

type FormData = Omit<CreateCustomAgent, 'organizationId'> & {
  changeDescription?: string;
};

interface CustomAgentEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: {
    _id: string;
    name: string;
    displayName: string;
    description?: string;
    systemInstructions: string;
    toolNames: string[];
    modelPreset: string;
    temperature?: number;
    maxTokens?: number;
    maxSteps?: number;
    includeKnowledge: boolean;
    knowledgeTopK?: number;
    teamId?: string;
    sharedWithTeamIds?: string[];
  };
}

export function CustomAgentEditDialog({
  open,
  onOpenChange,
  agent,
}: CustomAgentEditDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const updateAgent = useUpdateCustomAgent();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formSchema = useMemo(
    () => createCustomAgentSchema.omit({ organizationId: true }).extend({
      changeDescription: createCustomAgentSchema.shape.name.optional(),
    }),
    [],
  );

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: agent.name,
      displayName: agent.displayName,
      description: agent.description ?? '',
      systemInstructions: agent.systemInstructions,
      toolNames: agent.toolNames,
      modelPreset: agent.modelPreset as FormData['modelPreset'],
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      maxSteps: agent.maxSteps,
      includeKnowledge: agent.includeKnowledge,
      knowledgeTopK: agent.knowledgeTopK,
      teamId: agent.teamId,
      sharedWithTeamIds: agent.sharedWithTeamIds,
      changeDescription: '',
    },
  });

  const { handleSubmit, reset, register, formState } = form;

  useEffect(() => {
    if (open) {
      reset({
        name: agent.name,
        displayName: agent.displayName,
        description: agent.description ?? '',
        systemInstructions: agent.systemInstructions,
        toolNames: agent.toolNames,
        modelPreset: agent.modelPreset as FormData['modelPreset'],
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        maxSteps: agent.maxSteps,
        includeKnowledge: agent.includeKnowledge,
        knowledgeTopK: agent.knowledgeTopK,
        teamId: agent.teamId,
        sharedWithTeamIds: agent.sharedWithTeamIds,
        changeDescription: '',
      });
    }
  }, [open, agent, reset]);

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    try {
      const { changeDescription, toneOfVoiceId: _tov, ...fields } = data;
      await updateAgent({
        customAgentId: agent._id as any,
        ...fields,
        changeDescription: changeDescription || undefined,
      });
      toast({
        title: t('customAgents.agentUpdated'),
        variant: 'success',
      });
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast({
        title: t('customAgents.agentUpdateFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('customAgents.editAgent')}
      submitText={tCommon('actions.saveChanges')}
      submittingText={tCommon('actions.saving')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
      large
    >
      <Stack gap={4}>
        <CustomAgentFormFields form={form as any} />
        <Input
          id="changeDescription"
          label={t('customAgents.form.changeDescription')}
          placeholder={t('customAgents.form.changeDescriptionPlaceholder')}
          {...register('changeDescription')}
          errorMessage={formState.errors.changeDescription?.message}
        />
      </Stack>
    </FormDialog>
  );
}
