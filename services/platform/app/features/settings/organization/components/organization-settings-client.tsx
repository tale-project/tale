'use client';

import { useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { CopyableText } from '@/app/components/ui/data-display/copyable-field';
import { Form } from '@/app/components/ui/forms/form';
import { Input } from '@/app/components/ui/forms/input';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useDebounce } from '@/app/hooks/use-debounce';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';

import { AddMemberDialog } from './member-add-dialog';
import { MemberTable } from './member-table';

type Member = {
  _id: string;
  createdAt: number;
  organizationId: string;
  userId: string;
  email?: string;
  role?: string;
  displayName?: string;
};

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

interface OrganizationSettingsClientProps {
  organization: { _id: string; name: string } | null;
  memberContext: MemberContext | null;
  members: Member[];
}

interface OrganizationFormData {
  name: string;
}

export function OrganizationSettingsClient({
  organization,
  memberContext,
  members: initialMembers,
}: OrganizationSettingsClientProps) {
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false);
  const { toast } = useToast();

  const debouncedSearch = useDebounce(searchQuery, 300);

  const form = useForm<OrganizationFormData>({
    defaultValues: {
      name: organization?.name || '',
    },
  });

  const { formState, handleSubmit, register, reset } = form;
  const { isDirty, isSubmitting } = formState;

  const liveMembers = useQuery(
    api.members.queries.listByOrganization,
    organization ? { organizationId: organization._id } : 'skip',
  );

  // Use live members if available, otherwise fall back to initial members
  const allMembers = liveMembers ?? initialMembers;

  // Apply client-side filtering and sorting
  const members = allMembers
    .filter((member: Member) => {
      if (!debouncedSearch) return true;
      const search = debouncedSearch.toLowerCase();
      return (
        member.displayName?.toLowerCase().includes(search) ||
        member.email?.toLowerCase().includes(search)
      );
    })
    .sort((a: Member, b: Member) => {
      const nameA = a.displayName || a.email || '';
      const nameB = b.displayName || b.email || '';
      return sortOrder === 'asc'
        ? nameA.localeCompare(nameB)
        : nameB.localeCompare(nameA);
    });

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
            className="max-w-sm flex-1"
          />
          <Button
            type="submit"
            disabled={!isDirty || isSubmitting}
            className="bg-foreground text-background hover:bg-foreground/90"
          >
            {isSubmitting
              ? tCommon('actions.saving')
              : tCommon('actions.saveChanges')}
          </Button>
        </HStack>
      </Form>

      {organization && (
        <HStack
          gap={2}
          align="center"
          className="text-muted-foreground text-sm"
        >
          <span className="text-nowrap">
            {tSettings('organization.organizationId')}:
          </span>
          <CopyableText
            value={organization._id}
            className="min-w-0 [&>span]:truncate"
          />
        </HStack>
      )}

      <Stack className="pt-4">
        <Stack gap={1}>
          <h2 className="text-foreground text-base font-semibold">
            {tSettings('organization.membersTitle')}
          </h2>
          <p className="text-muted-foreground text-sm tracking-[-0.084px]">
            {tSettings('organization.manageAccess')}
          </p>
        </Stack>

        <HStack justify="between">
          <SearchInput
            placeholder={tSettings('organization.searchMember')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8"
            wrapperClassName="flex-1 max-w-sm"
          />
          {memberContext?.isAdmin && (
            <Button
              size="sm"
              onClick={() => setIsAddMemberDialogOpen(true)}
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              <Plus className="mr-2 size-4" />
              {tSettings('organization.addMember')}
            </Button>
          )}
        </HStack>

        <MemberTable
          members={members || []}
          sortOrder={sortOrder}
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
      </Stack>

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
