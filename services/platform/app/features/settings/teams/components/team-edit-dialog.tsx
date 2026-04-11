'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { useToast } from '@/app/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';

import { useAddTeamMember, useRemoveTeamMember } from '../hooks/mutations';
import { useTeamMembers, type Team } from '../hooks/queries';
import { TeamMemberChecklist } from './team-member-checklist';

interface TeamMemberItem {
  _id: string;
  userId: string;
}

interface TeamEditDialogProps {
  team: Team;
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type TeamFormData = {
  name: string;
};

export function TeamEditDialog({
  team,
  organizationId,
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
  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set<string>());
  const initialMemberIdsRef = useRef(new Set<string>());

  const { teamMembers }: { teamMembers: TeamMemberItem[] | undefined } =
    useTeamMembers(team.id);
  const addTeamMember = useAddTeamMember();
  const removeTeamMember = useRemoveTeamMember();

  // Sync selected members when team members data loads or dialog opens
  useEffect(() => {
    if (teamMembers && open) {
      const memberIds = new Set(teamMembers.map((m) => m.userId));
      setSelectedMemberIds(memberIds);
      initialMemberIdsRef.current = memberIds;
    }
  }, [teamMembers, open]);

  const form = useForm<TeamFormData>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      name: team.name,
    },
  });

  const { handleSubmit, register, reset, formState } = form;

  useEffect(() => {
    reset({ name: team.name });
  }, [team, reset]);

  const handleToggleMember = useCallback((userId: string) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        if (next.size <= 1) return prev; // Prevent removing last member
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  const hasMemberChanges = useMemo(() => {
    const initial = initialMemberIdsRef.current;
    if (initial.size !== selectedMemberIds.size) return true;
    for (const id of selectedMemberIds) {
      if (!initial.has(id)) return true;
    }
    return false;
  }, [selectedMemberIds]);

  const onSubmit = async (data: TeamFormData) => {
    setIsSubmitting(true);
    try {
      // Update team name if changed
      if (formState.isDirty) {
        const result = await authClient.organization.updateTeam({
          teamId: team.id,
          data: { name: data.name },
        });

        if (result.error) {
          throw new Error(result.error.message || 'Failed to update team');
        }
      }

      // Handle member changes
      if (hasMemberChanges && teamMembers) {
        const initial = initialMemberIdsRef.current;
        const toAdd = Array.from(selectedMemberIds).filter(
          (id) => !initial.has(id),
        );
        const toRemove = teamMembers.filter(
          (m) => !selectedMemberIds.has(m.userId),
        );

        const results = await Promise.allSettled([
          ...toAdd.map((userId) =>
            addTeamMember.mutateAsync({
              teamId: team.id,
              userId,
              organizationId,
            }),
          ),
          ...toRemove.map((m) =>
            removeTeamMember.mutateAsync({
              teamMemberId: m._id,
              organizationId,
            }),
          ),
        ]);
        const failures = results.filter((r) => r.status === 'rejected');
        if (failures.length > 0) {
          console.warn('Some membership changes failed:', failures);
        }
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

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      reset({ name: team.name });
      if (teamMembers) {
        const memberIds = new Set(teamMembers.map((m) => m.userId));
        setSelectedMemberIds(memberIds);
        initialMemberIdsRef.current = memberIds;
      }
    }
    onOpenChange(isOpen);
  };

  const isDirty = formState.isDirty || hasMemberChanges;

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={tSettings('teams.editTeam')}
      submitText={tSettings('teams.saveChanges')}
      submittingText={tCommon('actions.saving')}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
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
