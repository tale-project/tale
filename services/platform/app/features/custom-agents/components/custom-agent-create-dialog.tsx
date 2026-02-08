'use client';

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { useCreateCustomAgent } from '../hooks/use-custom-agent-mutations';
import { CustomAgentFormFields } from './custom-agent-form-fields';
import { createCustomAgentSchema, type CreateCustomAgent } from '@/lib/shared/schemas/custom_agents';

type FormData = Omit<CreateCustomAgent, 'organizationId'>;

interface CustomAgentCreateDialogProps {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CustomAgentCreateDialog({
  organizationId,
  open,
  onOpenChange,
}: CustomAgentCreateDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const createAgent = useCreateCustomAgent();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formSchema = useMemo(
    () => createCustomAgentSchema.omit({ organizationId: true }),
    [],
  );

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      displayName: '',
      description: '',
      systemInstructions: '',
      toolNames: [],
      modelPreset: 'standard',
      includeKnowledge: false,
    },
  });

  const { handleSubmit, reset } = form;

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    try {
      const { toneOfVoiceId: _tov, ...rest } = data;
      await createAgent({
        organizationId,
        ...rest,
      });
      toast({
        title: t('customAgents.agentCreated'),
        variant: 'success',
      });
      reset();
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast({
        title: t('customAgents.agentCreateFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      reset();
    }
    onOpenChange(open);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('customAgents.createAgent')}
      submitText={tCommon('actions.create')}
      submittingText={tCommon('actions.loading')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
      large
    >
      <CustomAgentFormFields form={form} />
    </FormDialog>
  );
}
