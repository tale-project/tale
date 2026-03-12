'use client';

import { Plus, Trash2, Users } from 'lucide-react';
import { useState, useMemo } from 'react';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { EmptyState } from '@/app/components/ui/feedback/empty-state';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Select } from '@/app/components/ui/forms/select';
import { BorderedSection } from '@/app/components/ui/layout/bordered-section';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useMembers } from '../../organization/hooks/queries';
import { useAddTeamMember, useRemoveTeamMember } from '../hooks/mutations';
import { useTeamMembers, type Team } from '../hooks/queries';

interface TeamMembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team: Team;
  organizationId: string;
}

export function TeamMembersDialog({
  open,
  onOpenChange,
  team,
  organizationId,
}: TeamMembersDialogProps) {
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');

  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [isAdding, setIsAdding] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const { members: orgMembers } = useMembers(organizationId);

  const { teamMembers, isLoading: isLoadingTeamMembers } = useTeamMembers(
    team.id,
  );

  const addTeamMember = useAddTeamMember();
  const removeTeamMember = useRemoveTeamMember();

  const isLoading = isLoadingTeamMembers;

  type OrgMember = NonNullable<typeof orgMembers>[number];
  type TeamMemberItem = NonNullable<typeof teamMembers>[number];

  const availableMembers = useMemo(() => {
    if (!orgMembers || !teamMembers) return [];
    const teamMemberIds = new Set(
      teamMembers.map((m: TeamMemberItem) => m.userId),
    );
    return orgMembers.filter(
      (m: OrgMember) => !!m.userId && !teamMemberIds.has(m.userId),
    );
  }, [orgMembers, teamMembers]);

  const memberDetailsMap = useMemo(() => {
    if (!orgMembers) return new Map<string, OrgMember>();
    return new Map(orgMembers.map((m: OrgMember) => [m.userId, m]));
  }, [orgMembers]);

  const handleAddMember = async () => {
    if (!selectedMemberId) return;

    setIsAdding(true);
    try {
      await addTeamMember.mutateAsync({
        teamId: team.id,
        userId: selectedMemberId,
        organizationId,
      });

      toast({
        title: tSettings('teams.memberAdded'),
        variant: 'success',
      });

      setSelectedMemberId('');
    } catch (error) {
      console.error(error);
      toast({
        title: tSettings('teams.memberAddFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveMember = async (teamMemberId: string) => {
    setRemovingMemberId(teamMemberId);
    try {
      await removeTeamMember.mutateAsync({
        teamMemberId,
        organizationId,
      });

      toast({
        title: tSettings('teams.memberRemoved'),
        variant: 'success',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: tSettings('teams.memberRemoveFailed'),
        variant: 'destructive',
      });
    } finally {
      setRemovingMemberId(null);
    }
  };

  return (
    <ViewDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${team.name} - ${tSettings('teams.manageMembers')}`}
    >
      <Stack gap={4}>
        <FormSection>
          <HStack gap={2}>
            <div className="flex-1">
              <Select
                value={selectedMemberId}
                onValueChange={setSelectedMemberId}
                placeholder={tSettings('teams.selectMember')}
                options={
                  availableMembers.length > 0
                    ? availableMembers.map((m: OrgMember) => ({
                        value: m.userId,
                        label: m.displayName || m.email || 'Unknown',
                      }))
                    : []
                }
                disabled={availableMembers.length === 0}
              />
            </div>
            <Button
              size="sm"
              onClick={handleAddMember}
              disabled={!selectedMemberId || isAdding}
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              <Plus className="mr-1 size-4" />
              {isAdding
                ? tCommon('actions.adding')
                : tSettings('teams.addMember')}
            </Button>
          </HStack>

          {availableMembers.length === 0 && !isLoading && (
            <Text variant="muted">{tSettings('teams.noMembersToAdd')}</Text>
          )}
        </FormSection>

        <Stack gap={2}>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Text as="span" variant="muted">
                {tCommon('actions.loading')}
              </Text>
            </div>
          ) : !teamMembers || teamMembers.length === 0 ? (
            <EmptyState icon={Users} title={tSettings('teams.noTeamMembers')} />
          ) : (
            teamMembers.map((member: TeamMemberItem) => {
              const details = memberDetailsMap.get(member.userId);
              const hasDistinctName =
                details?.displayName && details.displayName !== details.email;
              return (
                <BorderedSection
                  key={member._id}
                  className="flex-row items-center justify-between p-3"
                >
                  <Stack gap={1}>
                    <Text as="span" variant="label">
                      {hasDistinctName
                        ? details.displayName
                        : details?.email || 'Unknown'}
                    </Text>
                    {hasDistinctName && (
                      <Text as="span" variant="caption">
                        {details.email}
                      </Text>
                    )}
                  </Stack>
                  <Tooltip
                    content={
                      teamMembers.length <= 1
                        ? tSettings('teams.cannotRemoveLastMember')
                        : undefined
                    }
                  >
                    <span className="inline-flex">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveMember(member._id)}
                        disabled={
                          removingMemberId === member._id ||
                          teamMembers.length <= 1
                        }
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        aria-label={tSettings('teams.removeMember')}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </span>
                  </Tooltip>
                </BorderedSection>
              );
            })
          )}
        </Stack>

        <Button
          variant="secondary"
          onClick={() => onOpenChange(false)}
          className="w-full"
        >
          {tCommon('actions.close')}
        </Button>
      </Stack>
    </ViewDialog>
  );
}
