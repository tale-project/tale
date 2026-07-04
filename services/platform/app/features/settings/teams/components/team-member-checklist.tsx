'use client';

import { Row, Stack } from '@tale/ui/layout';
import { useCallback, useMemo } from 'react';

import {
  MultiSelect,
  type MultiSelectOption,
} from '@/app/components/ui/forms/multi-select';
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
  enforceMinimumOne?: boolean;
}

export function TeamMemberChecklist({
  organizationId,
  selectedMemberIds,
  onToggleMember,
  enforceMinimumOne = false,
}: TeamMemberChecklistProps) {
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const { members: orgMembers, isLoading } = useMembers(organizationId);

  // A team must keep at least one member (the backend rejects removing the last
  // one), so the sole remaining selected member's option is disabled rather than
  // silently refusing the toggle. Only enforced in the edit flow — the create
  // flow permits 0 selected members.
  const isLastMember = enforceMinimumOne && selectedMemberIds.size <= 1;

  const options = useMemo<MultiSelectOption[]>(
    () =>
      (orgMembers ?? []).map((member: MemberOption) => {
        const label =
          member.displayName ||
          member.email ||
          tSettings('teams.unknownMember');
        // Surface the email as a secondary line only when it adds information
        // beyond the (display name) label.
        const description =
          member.displayName &&
          member.email &&
          member.displayName !== member.email
            ? member.email
            : undefined;
        // Block unchecking the only remaining member — keeping a team memberless
        // is rejected server-side.
        const disabled = isLastMember && selectedMemberIds.has(member.userId);
        return { value: member.userId, label, description, disabled };
      }),
    [orgMembers, tSettings, isLastMember, selectedMemberIds],
  );

  // `MultiSelect` reports the COMPLETE next selection; the parent still drives a
  // single toggle at a time, so diff the new list against the current Set and
  // forward the one id that flipped.
  const handleChange = useCallback(
    (next: string[]) => {
      const nextSet = new Set(next);
      for (const id of next) {
        if (!selectedMemberIds.has(id)) onToggleMember(id);
      }
      for (const id of selectedMemberIds) {
        if (!nextSet.has(id)) onToggleMember(id);
      }
    },
    [selectedMemberIds, onToggleMember],
  );

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
      <p className="text-muted-foreground text-xs">
        {tSettings('teams.memberChecklistHint')}
      </p>
      <MultiSelect
        label={tSettings('teams.manageMembers')}
        value={Array.from(selectedMemberIds)}
        onValueChange={handleChange}
        options={options}
        placeholder={tSettings('teams.manageMembers')}
        searchPlaceholder={tCommon('search.placeholder')}
        emptyText={tCommon('search.noResults')}
        aria-label={tSettings('teams.manageMembers')}
        modal
      />
      {isLastMember && (
        <p className="text-muted-foreground text-xs">
          {tSettings('teams.lastMemberHint')}
        </p>
      )}
    </Stack>
  );
}
