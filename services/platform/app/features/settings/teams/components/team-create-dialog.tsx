'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { useToast } from '@/app/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';

import { useCreateTeamMember } from '../hooks/mutations';
import { TeamMemberChecklist } from './team-member-checklist';

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
  const { mutateAsync: addMember } = useCreateTeamMember();

  const nameRequiredError = tSettings('teams.teamNameRequired');
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, nameRequiredError),
      }),
    [nameRequiredError],
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set<string>());

  const form = useForm<TeamFormData>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      name: '',
    },
  });

  const { handleSubmit, register, reset, formState } = form;

  const handleToggleMember = useCallback((userId: string) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

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

      // Add selected members to the team
      const memberIds = Array.from(selectedMemberIds);
      if (memberIds.length === 0) {
        // If no members selected, add the current user as default
        const session = await authClient.getSession();
        const userId = session.data?.user?.id;
        if (userId) {
          await addMember({ teamId, userId, organizationId });
        }
      } else {
        const results = await Promise.allSettled(
          memberIds.map((userId) =>
            addMember({ teamId, userId, organizationId }),
          ),
        );
        const failedCount = results.filter(
          (r) => r.status === 'rejected',
        ).length;
        if (failedCount > 0) {
          console.warn(
            `Failed to add ${failedCount} of ${memberIds.length} members`,
          );
        }
      }

      const memberCount = memberIds.length > 0 ? memberIds.length : 1;

      toast({
        title: tSettings('teams.teamCreated'),
        description: tSettings('teams.teamCreatedDescription', {
          name: data.name,
          count: memberCount,
        }),
        variant: 'success',
      });

      reset();
      setSelectedMemberIds(new Set());
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

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      reset();
      setSelectedMemberIds(new Set());
    }
    onOpenChange(isOpen);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={tSettings('teams.createTeam')}
      submitText={tSettings('teams.createTeam')}
      submittingText={tCommon('actions.loading')}
      isSubmitting={isSubmitting}
      isValid={formState.isValid}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="name"
        label={tSettings('teams.teamName')}
        placeholder={tSettings('teams.teamNamePlaceholder')}
        {...register('name')}
        className="w-full"
        required
        errorMessage={formState.errors.name?.message}
      />
      <TeamMemberChecklist
        organizationId={organizationId}
        selectedMemberIds={selectedMemberIds}
        onToggleMember={handleToggleMember}
      />
    </FormDialog>
  );
}
