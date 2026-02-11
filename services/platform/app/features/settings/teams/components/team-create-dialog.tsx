'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { useToast } from '@/app/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';

import { useAddTeamMember } from '../hooks/mutations';

interface TeamCreateDialogProps {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type TeamFormData = {
  name: string;
};

export function TeamCreateDialog({
  organizationId,
  open,
  onOpenChange,
  onSuccess,
}: TeamCreateDialogProps) {
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const addMember = useAddTeamMember();

  const nameRequiredError = tSettings('teams.teamNameRequired');
  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(1, nameRequiredError)
          .transform((val) => val.trim()),
      }),
    [nameRequiredError],
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<TeamFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
    },
  });

  const { handleSubmit, register, reset, formState } = form;

  const onSubmit = async (data: TeamFormData) => {
    setIsSubmitting(true);
    try {
      const result = await authClient.organization.createTeam({
        name: data.name,
        organizationId,
      });

      if (result.error) {
        throw new Error(result.error.message || 'Failed to create team');
      }

      const teamId = result.data?.id;
      if (!teamId) {
        throw new Error('Team ID not returned');
      }

      const session = await authClient.getSession();
      const userId = session.data?.user?.id;
      if (!userId) {
        throw new Error('User not authenticated');
      }

      await addMember({
        teamId,
        userId,
        organizationId,
      });

      toast({
        title: tSettings('teams.teamCreated'),
        variant: 'success',
      });

      reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error(error);
      toast({
        title: tSettings('teams.teamCreateFailed'),
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
      title={tSettings('teams.createTeam')}
      submitText={tCommon('actions.create')}
      submittingText={tCommon('actions.loading')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="name"
        label={tCommon('labels.name')}
        placeholder={tSettings('teams.title')}
        {...register('name')}
        className="w-full"
        required
        errorMessage={formState.errors.name?.message}
      />
    </FormDialog>
  );
}
