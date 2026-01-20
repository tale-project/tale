'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from 'convex/react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/app/components/ui/primitives/button';
import { Input } from '@/app/components/ui/forms/input';
import { Form } from '@/app/components/ui/forms/form';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { api } from '@/convex/_generated/api';
import { Search, Plus } from 'lucide-react';
import { useToast } from '@/app/hooks/use-toast';
import { AddMemberDialog } from './member-add-dialog';
import { MemberTable } from './member-table';
import { useDebounce } from '@/app/hooks/use-debounce';
import { useT } from '@/lib/i18n/client';

type Member = {
  _id: string;
  _creationTime?: number;
  organizationId: string;
  userId?: string;
  email?: string;
  role?: string;
  displayName?: string;
  createdAt?: number;
};

type MemberContext = {
  member?: Member | null;
  role?: string | null;
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
            className="flex-1 max-w-sm"
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

      <Stack className="pt-4">
        <Stack gap={1}>
          <h2 className="text-base font-semibold text-foreground">
            {tSettings('organization.membersTitle')}
          </h2>
          <p className="text-sm text-muted-foreground tracking-[-0.084px]">
            {tSettings('organization.manageAccess')}
          </p>
        </Stack>

        <HStack justify="between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder={tSettings('organization.searchMember')}
              size="sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          {memberContext?.isAdmin && (
            <Button
              size="sm"
              onClick={() => setIsAddMemberDialogOpen(true)}
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              <Plus className="size-4 mr-2" />
              {tSettings('organization.addMember')}
            </Button>
          )}
        </HStack>

        <MemberTable
          members={members || []}
          sortOrder={sortOrder}
          memberContext={memberContext ? {
            member: memberContext.member || null,
            role: memberContext.role || null,
            isAdmin: memberContext.isAdmin || false,
          } : undefined}
          onSortChange={(newSortOrder) => {
            setSortOrder(newSortOrder);
          }}
        />
      </Stack>

      <AddMemberDialog
        organizationId={organization?._id as string}
        open={isAddMemberDialogOpen}
        onOpenChange={setIsAddMemberDialogOpen}
      />
    </Stack>
  );
}
