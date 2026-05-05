'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Skeleton } from '@tale/ui/skeleton';
import { Pencil, Users } from 'lucide-react';
import { useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

import { useTeamMembers, type Team } from '../hooks/queries';
import { TeamEditDialog } from './team-edit-dialog';

interface TeamDetailMember {
  _id: string;
  userId: string;
  displayName?: string;
  email?: string;
  role: string;
}

interface TeamDetailDialogProps {
  team: Team;
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function TeamDetailDialogContent({
  team,
  organizationId,
  open,
  onOpenChange,
}: TeamDetailDialogProps) {
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const { teamMembers, isLoading } = useTeamMembers(team.id);
  const [editOpen, setEditOpen] = useState(false);

  const memberCount = teamMembers?.length ?? 0;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={team.name}
        description={
          isLoading
            ? undefined
            : tSettings('teams.memberCount', { count: memberCount })
        }
        size="md"
        footer={
          <HStack gap={2} justify="end">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {tCommon('actions.cancel')}
            </Button>
            <Button onClick={() => setEditOpen(true)}>
              <Pencil className="mr-1.5 size-3.5" />
              {tCommon('actions.edit')}
            </Button>
          </HStack>
        }
      >
        <Stack gap={4}>
          <Text variant="label" className="text-sm">
            {tSettings('teams.manageMembers')}
          </Text>

          {isLoading ? (
            <Stack gap={3}>
              {Array.from({ length: 3 }).map((_, i) => (
                <HStack key={i} gap={3} align="center">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <Stack gap={1} className="flex-1">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </Stack>
                </HStack>
              ))}
            </Stack>
          ) : !teamMembers || teamMembers.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-6">
              <Users className="text-muted-foreground size-8" />
              <Text variant="muted" className="text-sm">
                {tSettings('teams.noTeamMembers')}
              </Text>
            </div>
          ) : (
            <div className="border-border overflow-hidden rounded-lg border">
              {teamMembers.map((member: TeamDetailMember, index: number) => (
                <div
                  key={member._id}
                  className={`flex items-center gap-3 px-3 py-2.5 ${
                    index < teamMembers.length - 1
                      ? 'border-border border-b'
                      : ''
                  }`}
                >
                  <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full">
                    <Text className="text-muted-foreground text-xs font-medium">
                      {(member.displayName || member.email || '?')
                        .charAt(0)
                        .toUpperCase()}
                    </Text>
                  </div>
                  <Stack gap={0} className="min-w-0 flex-1">
                    <Text className="truncate text-sm font-medium">
                      {member.displayName ||
                        member.email ||
                        tSettings('teams.unknownMember')}
                    </Text>
                    {member.email &&
                      member.displayName &&
                      member.displayName !== member.email && (
                        <Text variant="muted" className="truncate text-xs">
                          {member.email}
                        </Text>
                      )}
                  </Stack>
                  <Badge variant="outline" className="shrink-0 capitalize">
                    {member.role}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Stack>
      </Dialog>

      <TeamEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        team={team}
        organizationId={organizationId}
      />
    </>
  );
}

export function TeamDetailDialog(props: TeamDetailDialogProps) {
  if (!props.open) return null;
  return <TeamDetailDialogContent {...props} />;
}
