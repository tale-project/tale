'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, usePreloadedQuery } from 'convex/react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/forms/input';
import { Form } from '@/components/ui/forms/form';
import { Stack, HStack } from '@/components/ui/layout/layout';
import { api } from '@/convex/_generated/api';
import { Search, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { AddMemberDialog } from './member-add-dialog';
import { MemberTable } from './member-table';
import { useDebounce } from '@/hooks/use-debounce';
import { useT } from '@/lib/i18n/client';
import type {
  PreloadedMemberContext,
  PreloadedMembers,
} from '../page';

export interface OrganizationSettingsProps {
  organization: { _id: string; name: string } | null;
  preloadedMemberContext: PreloadedMemberContext;
  preloadedMembers: PreloadedMembers;
}

interface OrganizationFormData {
  name: string;
}

export function OrganizationSettings({
  organization,
  preloadedMemberContext,
  preloadedMembers,
}: OrganizationSettingsProps) {
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false);
  const { toast } = useToast();

  // Debounce search query for server-side filtering
  const debouncedSearch = useDebounce(searchQuery, 300);

  const form = useForm<OrganizationFormData>({
    defaultValues: {
      name: organization?.name || '',
    },
  });

  const { formState, handleSubmit, register, reset } = form;
  const { isDirty, isSubmitting } = formState;

  // Use preloaded member context for SSR + real-time reactivity
  const memberContext = usePreloadedQuery(preloadedMemberContext);

  // Use preloaded members for initial render, switch to useQuery for dynamic filtering
  const hasFilters = sortOrder !== 'asc' || !!debouncedSearch;
  const preloadedMembersData = usePreloadedQuery(preloadedMembers);

  // Use useQuery only when filters are applied for dynamic updates
  const filteredMembers = useQuery(
    api.member.listByOrganization,
    hasFilters
      ? {
          organizationId: organization?._id as string,
          sortOrder,
          search: debouncedSearch || undefined,
        }
      : 'skip',
  );

  // Use filtered results when available, otherwise use preloaded data
  const members = hasFilters ? filteredMembers : preloadedMembersData;

  const onSubmit = async (data: OrganizationFormData) => {
    if (!organization) return;

    try {
      await authClient.organization.update({
        organizationId: organization._id,
        data: { name: data.name.trim() || undefined },
      });

      // Reset form to mark as clean
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
            {isSubmitting ? tCommon('actions.saving') : tCommon('actions.saveChanges')}
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
          {memberContext?.canManageMembers && (
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
          memberContext={memberContext}
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
