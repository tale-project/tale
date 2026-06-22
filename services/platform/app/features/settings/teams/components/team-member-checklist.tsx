'use client';

import { Row, Stack } from '@tale/ui/layout';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { useT } from '@/lib/i18n/client';

import { useMembers } from '../../organization/hooks/queries';

interface MemberOption {
  userId: string;
  displayName?: string;
  email?: string;
}

interface TeamMemberChecklistProps {
  organizationId: string;
  selectedMemberIds: Set<string>;
  onToggleMember: (userId: string) => void;
}

export function TeamMemberChecklist({
  organizationId,
  selectedMemberIds,
  onToggleMember,
}: TeamMemberChecklistProps) {
  const { t: tSettings } = useT('settings');
  const { members: orgMembers, isLoading } = useMembers(organizationId);

  if (isLoading) {
    return (
      <Row gap={0} justify="center" className="py-4">
        <p className="text-muted-foreground text-sm">
          {tSettings('teams.loadingMembers')}
        </p>
      </Row>
    );
  }

  if (!orgMembers || orgMembers.length === 0) {
    return (
      <Row gap={0} justify="center" className="py-4">
        <p className="text-muted-foreground text-sm">
          {tSettings('teams.noMembersToAdd')}
        </p>
      </Row>
    );
  }

  return (
    <Stack gap={2}>
      <p className="text-foreground/80 text-sm font-medium">
        {tSettings('teams.manageMembers')}
      </p>
      <p className="text-muted-foreground text-xs">
        {tSettings('teams.memberChecklistHint')}
      </p>
      <div className="border-border overflow-hidden rounded-lg border">
        {orgMembers.map((member: MemberOption, index: number) => {
          const isLast = index === orgMembers.length - 1;
          const isChecked = selectedMemberIds.has(member.userId);

          return (
            <label
              key={member.userId}
              className={`hover:bg-muted/50 flex cursor-pointer items-center gap-2.5 px-3 py-2.5 transition-colors ${
                !isLast ? 'border-border border-b' : ''
              }`}
            >
              <Checkbox
                checked={isChecked}
                onCheckedChange={() => onToggleMember(member.userId)}
              />
              <span className="flex items-center gap-2">
                <span className="text-foreground text-sm">
                  {member.displayName ||
                    member.email ||
                    tSettings('teams.unknownMember')}
                </span>
                {member.displayName &&
                  member.email &&
                  member.displayName !== member.email && (
                    <span className="text-muted-foreground text-xs">
                      {member.email}
                    </span>
                  )}
              </span>
            </label>
          );
        })}
      </div>
    </Stack>
  );
}
