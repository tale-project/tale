'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState, useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { useToast } from '@/app/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';

import type { Team } from '../hooks/collections';

interface TeamEditDialogProps {
  team: Team;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type TeamFormData = {
  name: string;
};

export function TeamEditDialog({
  team,
  open,
  onOpenChange,
  onSuccess,
}: TeamEditDialogProps) {
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, tSettings('teams.teamNameRequired')),
      }),
    [tSettings],
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<TeamFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: team.name,
    },
  });

  const { handleSubmit, register, reset, formState } = form;

  // Reset form when team changes
  useEffect(() => {
    reset({ name: team.name });
  }, [team, reset]);

  const onSubmit = async (data: TeamFormData) => {
    setIsSubmitting(true);
    try {
      const result = await authClient.organization.updateTeam({
        teamId: team.id,
        data: { name: data.name },
      });

      if (result.error) {
        throw new Error(result.error.message || 'Failed to update team');
      }

      toast({
        title: tSettings('teams.teamUpdated'),
        variant: 'success',
      });

      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error(error);
      toast({
        title: tSettings('teams.teamUpdateFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      reset({ name: team.name });
    }
    onOpenChange(open);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={tSettings('teams.editTeam')}
      submitText={tCommon('actions.save')}
      submittingText={tCommon('actions.saving')}
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
