'use client';

import { Plus } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';

import { CopyableText } from '@/app/components/ui/data-display/copyable-field';
import { Field } from '@/app/components/ui/forms/field';
import { Form } from '@/app/components/ui/forms/form';
import { Input } from '@/app/components/ui/forms/input';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { ActionRow } from '@/app/components/ui/layout/action-row';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Button } from '@/app/components/ui/primitives/button';
import { useDebounce } from '@/app/hooks/use-debounce';
import { useToast } from '@/app/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';

import { useMembers } from '../hooks/queries';
import { AddMemberDialog } from './member-add-dialog';
import { MemberTable } from './member-table';

type MemberContext = {
  memberId?: string;
  organizationId?: string;
  userId?: string;
  role?: string | null;
  createdAt?: number;
  displayName?: string;
  isAdmin?: boolean;
  canManageMembers?: boolean;
  canChangePassword?: boolean;
};

interface OrganizationSettingsProps {
  organization: { _id: string; name: string } | null;
  memberContext: MemberContext | null;
}

interface OrganizationFormData {
  name: string;
}

export function OrganizationSettings({
  organization,
  memberContext,
}: OrganizationSettingsProps) {
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false);
  const { toast } = useToast();

  const debouncedSearch = useDebounce(searchQuery, 300);

  const form = useForm<OrganizationFormData>({
    mode: 'onChange',
    defaultValues: {
      name: organization?.name || '',
    },
  });

  const { formState, handleSubmit, register, reset } = form;
  const { isSubmitting, isDirty } = formState;

  const { members: allMembers, isLoading: isMembersLoading } = useMembers(
    organization?._id ?? '',
  );

  const members = useMemo(() => {
    if (!allMembers) return null;
    const search = debouncedSearch?.toLowerCase();
    let filtered = allMembers;
    if (search) {
      filtered = filtered.filter(
        (member) =>
          (member.displayName?.toLowerCase().includes(search) ?? false) ||
          (member.email?.toLowerCase().includes(search) ?? false),
      );
    }
    return [...filtered].sort((a, b) => {
      const nameA = a.displayName || a.email || '';
      const nameB = b.displayName || b.email || '';
      return sortOrder === 'asc'
        ? nameA.localeCompare(nameB)
        : nameB.localeCompare(nameA);
    });
  }, [allMembers, debouncedSearch, sortOrder]);

  const onSubmit = async (data: OrganizationFormData) => {
    if (!organization) return;

    try {
      await authClient.organization.update({
        organizationId: organization._id,
        data: { name: data.name.trim() || undefined },
      });

      reset(data);

      toast({
        title: tToast('success.organizationUpdated'),
        variant: 'success',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: tToast('error.organizationUpdateFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <Stack>
      <Form onSubmit={handleSubmit(onSubmit)} className="space-y-0">
        <HStack gap={3} align="end" justify="between">
          <Input
            id="org-name"
            label={tSettings('organization.title')}
            {...register('name')}
            wrapperClassName="max-w-sm flex-1"
          />
          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting
              ? tCommon('actions.saving')
              : tCommon('actions.saveChanges')}
          </Button>
        </HStack>
      </Form>

      {organization && (
        <Field label={tSettings('organization.organizationId')}>
          <CopyableText
            value={organization._id}
            className="min-w-0 [&>span]:truncate"
          />
        </Field>
      )}

      <PageSection
        title={tSettings('organization.membersTitle')}
        description={tSettings('organization.manageAccess')}
        className="pt-4"
      >
        <ActionRow justify="between">
          <SearchInput
            placeholder={tSettings('organization.searchMember')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8"
            wrapperClassName="flex-1 max-w-sm"
          />
          {memberContext?.isAdmin && (
            <Button size="sm" onClick={() => setIsAddMemberDialogOpen(true)}>
              <Plus className="mr-2 size-4" />
              {tSettings('organization.addMember')}
            </Button>
          )}
        </ActionRow>

        <MemberTable
          members={members || []}
          sortOrder={sortOrder}
          isLoading={isMembersLoading}
          approxRowCount={5}
          memberContext={
            memberContext
              ? {
                  member: memberContext.memberId
                    ? {
                        _id: memberContext.memberId,
                        createdAt: memberContext.createdAt ?? 0,
                        organizationId: memberContext.organizationId ?? '',
                        userId: memberContext.userId ?? '',
                        role: memberContext.role ?? undefined,
                        displayName: memberContext.displayName,
                      }
                    : null,
                  role: memberContext.role || null,
                  isAdmin: memberContext.isAdmin || false,
                  canManageMembers:
                    memberContext.canManageMembers ??
                    memberContext.isAdmin ??
                    false,
                }
              : undefined
          }
          onSortChange={(newSortOrder) => {
            setSortOrder(newSortOrder);
          }}
        />
      </PageSection>

      {organization && (
        <AddMemberDialog
          organizationId={organization._id}
          open={isAddMemberDialogOpen}
          onOpenChange={setIsAddMemberDialogOpen}
        />
      )}
    </Stack>
  );
}
