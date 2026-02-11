'use client';

import { Plus, Trash2, Users } from 'lucide-react';
import { useState, useMemo } from 'react';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Select } from '@/app/components/ui/forms/select';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import type { Team } from '../hooks/collections';

import {
  useMemberCollection,
  useMembers,
} from '../../organization/hooks/collections';
import { useTeamMemberCollection, useTeamMembers } from '../hooks/collections';
import { useAddTeamMember, useRemoveTeamMember } from '../hooks/mutations';

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

  const memberCollection = useMemberCollection(organizationId);
  const { members: orgMembers } = useMembers(memberCollection);

  const teamMemberCollection = useTeamMemberCollection(
    open ? team.id : undefined,
  );
  const { teamMembers, isLoading: isLoadingTeamMembers } =
    useTeamMembers(teamMemberCollection);

  const addTeamMember = useAddTeamMember();
  const removeTeamMember = useRemoveTeamMember(teamMemberCollection);

  const isLoading = isLoadingTeamMembers;

  type OrgMember = NonNullable<typeof orgMembers>[number];
  type TeamMemberItem = NonNullable<typeof teamMembers>[number];

  // Get members that are not yet in the team
  const availableMembers = useMemo(() => {
    if (!orgMembers || !teamMembers) return [];
    const teamMemberIds = new Set(
      teamMembers.map((m: TeamMemberItem) => m.userId),
    );
    return orgMembers.filter(
      (m: OrgMember) => !!m.userId && !teamMemberIds.has(m.userId),
    );
  }, [orgMembers, teamMembers]);

  // Create a lookup map for member details
  const memberDetailsMap = useMemo(() => {
    if (!orgMembers) return new Map<string, OrgMember>();
    return new Map(orgMembers.map((m: OrgMember) => [m.userId, m]));
  }, [orgMembers]);

  const handleAddMember = async () => {
    if (!selectedMemberId) return;

    setIsAdding(true);
    try {
      await addTeamMember({
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
      await removeTeamMember({
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
        {/* Add member section */}
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
          <p className="text-muted-foreground text-sm">
            {tSettings('teams.noMembersToAdd')}
          </p>
        )}

        {/* Team members list */}
        <Stack gap={2}>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-muted-foreground">
                {tCommon('actions.loading')}
              </span>
            </div>
          ) : !teamMembers || teamMembers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Users className="text-muted-foreground/50 mb-2 size-8" />
              <p className="text-muted-foreground text-sm">
                {tSettings('teams.noTeamMembers')}
              </p>
            </div>
          ) : (
            teamMembers.map((member: TeamMemberItem) => {
              const details = memberDetailsMap.get(member.userId);
              const hasDistinctName =
                details?.displayName && details.displayName !== details.email;
              return (
                <HStack
                  key={member._id}
                  justify="between"
                  align="center"
                  className="bg-card rounded-lg border p-3"
                >
                  <Stack gap={1}>
                    <span className="text-sm font-medium">
                      {hasDistinctName
                        ? details.displayName
                        : details?.email || 'Unknown'}
                    </span>
                    {hasDistinctName && (
                      <span className="text-muted-foreground text-xs">
                        {details.email}
                      </span>
                    )}
                  </Stack>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveMember(member._id)}
                    disabled={removingMemberId === member._id}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    aria-label={tSettings('teams.removeMember')}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </HStack>
              );
            })
          )}
        </Stack>

        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          className="w-full"
        >
          {tCommon('actions.close')}
        </Button>
      </Stack>
    </ViewDialog>
  );
}
