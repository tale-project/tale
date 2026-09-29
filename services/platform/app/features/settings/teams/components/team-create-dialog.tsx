'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { useForm } from '@tale/ui/use-form';
import { useToast } from '@tale/ui/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, useMemo } from 'react';
import * as z from 'zod';

import { authClientError } from '@/app/lib/auth/auth-client-error';
import { failureDetail } from '@/app/lib/backend/adapters';
import { backendEntityPrefix } from '@/app/lib/backend/query-keys';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { TEAM_HINT_ENTITY } from '@/lib/shared/hint-entities';
import { backendErrorCode } from '@/lib/utils/backend-error';

import { useCreateTeamMember } from '../hooks/mutations';
import { TeamMemberChecklist } from './team-member-checklist';

/** Better Auth's `createTeam` sets no name cap, so a team name would otherwise
 *  persist unbounded. Cap it client-side at the workspace-name limit (the same
 *  80 as a project name) so an over-long name is rejected inline. */
const TEAM_NAME_MAX = 80;

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
  const queryClient = useQueryClient();
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const { mutateAsync: addMember } = useCreateTeamMember();

  const nameRequiredError = tSettings('teams.teamNameRequired');
  const nameTooLongError = tCommon('validation.maxLength', {
    field: tSettings('teams.teamName'),
    max: TEAM_NAME_MAX,
  });
  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, nameRequiredError)
          .max(TEAM_NAME_MAX, nameTooLongError),
      }),
    [nameRequiredError, nameTooLongError],
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set<string>());

  const form = useForm<TeamFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
    },
  });

  const { handleSubmit, register, reset, formState, setError } = form;

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
        // The server's uniqueness rule (`TEAM_NAME_TAKEN`, 409): the name
        // reads the same as another team's. Said under the field, where
        // the fix is, instead of a generic failure toast.
        if (result.error.code === 'TEAM_NAME_TAKEN') {
          setError('name', {
            type: 'server',
            message: tSettings('teams.teamNameTaken'),
          });
          return;
        }
        throw authClientError(result.error);
      }
      await queryClient.invalidateQueries({
        queryKey: backendEntityPrefix(organizationId, TEAM_HINT_ENTITY),
      });

      const teamId = result.data?.id;
      if (!teamId) {
        // An answer of the wrong shape is a fault, not words for the toast.
        throw new TypeError('createTeam answered no team id');
      }

      // The selected members join the team; with none selected, the creator.
      let memberIds = Array.from(selectedMemberIds);
      if (memberIds.length === 0) {
        const session = await authClient.getSession();
        const userId = session.data?.user?.id;
        memberIds = userId ? [userId] : [];
      }
      const results = await Promise.allSettled(
        memberIds.map((userId) =>
          addMember({ teamId, userId, organizationId }),
        ),
      );
      const refused = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );

      if (refused.length > 0) {
        console.warn(
          `Failed to add ${refused.length} of ${memberIds.length} members:`,
          refused,
        );
        await queryClient.invalidateQueries({
          queryKey: backendEntityPrefix(organizationId, TEAM_HINT_ENTITY),
        });
        // The team exists, so this is not "couldn't create": one toast says
        // it was created without every member, and why, as the edit dialog
        // says a refused membership change — a lapsed session in its own
        // words, else a count.
        const lapsed = refused.find(
          (f) => backendErrorCode(f.reason) === 'UNAUTHORIZED',
        );
        toast({
          title: tSettings('teams.teamCreatedMembersRefused'),
          description: lapsed
            ? failureDetail(lapsed.reason)
            : tSettings('teams.membershipChangesFailed', {
                count: refused.length,
              }),
          variant: 'destructive',
        });
      } else {
        toast({
          title: tSettings('teams.teamCreated'),
          description: tSettings('teams.teamCreatedDescription', {
            name: data.name,
            count: memberIds.length,
          }),
          variant: 'success',
        });
      }

      reset();
      setSelectedMemberIds(new Set());
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error(error);
      toast({
        title: tSettings('teams.teamCreateFailed'),
        description: failureDetail(error),
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
