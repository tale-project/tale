'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { ViewDialog } from '@/components/ui/dialog/view-dialog';
import { Button } from '@/components/ui/primitives/button';
import { Select } from '@/components/ui/forms/select';
import { Stack, HStack } from '@/components/ui/layout/layout';
import { Plus, Trash2, Users } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import type { Team } from '../hooks/use-list-teams';

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

  // Fetch organization members from Convex
  const orgMembers = useQuery(api.member.listByOrganization, {
    organizationId,
    sortOrder: 'asc',
  });

  // Fetch team members directly from Convex
  const teamMembers = useQuery(
    api.team_members.listByTeam,
    open ? { teamId: team.id } : 'skip'
  );

  // Convex mutations for team member management
  const addTeamMember = useMutation(api.team_members.addMember);
  const removeTeamMember = useMutation(api.team_members.removeMember);

  const isLoading = teamMembers === undefined;

  // Get members that are not yet in the team
  const availableMembers = useMemo(() => {
    if (!orgMembers || !teamMembers) return [];
    const teamMemberIds = new Set(teamMembers.map((m) => m.userId));
    return orgMembers.filter(
      (m): m is typeof m & { identityId: string } =>
        !!m.identityId && !teamMemberIds.has(m.identityId)
    );
  }, [orgMembers, teamMembers]);

  // Get member details for display
  const getMemberDetails = (userId: string) => {
    return orgMembers?.find((m) => m.identityId === userId);
  };

  const handleAddMember = async () => {
    if (!selectedMemberId) return;

    setIsAdding(true);
    try {
      await addTeamMember({
        teamId: team.id,
        userId: selectedMemberId,
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

  const handleRemoveMember = async (userId: string) => {
    setRemovingMemberId(userId);
    try {
      await removeTeamMember({
        teamId: team.id,
        userId,
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
                  ? availableMembers.map((m) => ({
                      value: m.identityId,
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
            <Plus className="size-4 mr-1" />
            {isAdding ? tCommon('actions.adding') : tSettings('teams.addMember')}
          </Button>
        </HStack>

        {availableMembers.length === 0 && !isLoading && (
          <p className="text-sm text-muted-foreground">
            {tSettings('teams.noMembersToAdd')}
          </p>
        )}

        {/* Team members list */}
        <Stack gap={2}>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-muted-foreground">{tCommon('actions.loading')}</span>
            </div>
          ) : !teamMembers || teamMembers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Users className="size-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">
                {tSettings('teams.noTeamMembers')}
              </p>
            </div>
          ) : (
            teamMembers.map((member) => {
              const details = getMemberDetails(member.userId);
              const hasDistinctName = details?.displayName && details.displayName !== details.email;
              return (
                <HStack
                  key={member._id}
                  justify="between"
                  align="center"
                  className="p-3 rounded-lg border bg-card"
                >
                  <Stack gap={1}>
                    <span className="text-sm font-medium">
                      {hasDistinctName ? details.displayName : (details?.email || 'Unknown')}
                    </span>
                    {hasDistinctName && (
                      <span className="text-xs text-muted-foreground">
                        {details.email}
                      </span>
                    )}
                  </Stack>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveMember(member.userId)}
                    disabled={removingMemberId === member.userId}
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

        <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full">
          {tCommon('actions.close')}
        </Button>
      </Stack>
    </ViewDialog>
  );
}
