'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from 'convex/react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { api } from '@/convex/_generated/api';
import { Search, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import AddMemberDialog from './add-member-dialog';
import MemberTable from './member-table';
import { useDebounce } from '@/hooks/use-debounce';

export interface OrganizationSettingsProps {
  organization: { _id: string; name: string } | null;
}

interface OrganizationFormData {
  name: string;
}

export default function OrganizationSettings({
  organization,
}: OrganizationSettingsProps) {
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

  // Updates are handled through Better Auth client-side API

  // Search filtering is now done server-side in the Convex query
  const members = useQuery(api.member.listByOrganization, {
    organizationId: organization?._id as string,
    sortOrder,
    search: debouncedSearch || undefined,
  });

  const memberContext = useQuery(api.member.getCurrentMemberContext, {
    organizationId: organization?._id as string,
  });

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
        title: 'Organization updated successfully',
        variant: 'success',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: 'Failed to update organization',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Organization Name */}
        <div className="space-y-2">
          <Label
            htmlFor="org-name"
            className="text-sm font-medium text-foreground"
          >
            Organization (optional)
          </Label>
          <div className="flex items-center gap-3 justify-between">
            <Input
              id="org-name"
              {...register('name')}
              className="flex-1 max-w-sm"
            />
            <Button
              type="submit"
              disabled={!isDirty || isSubmitting}
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              {isSubmitting ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
        </div>
      </form>

      {/* Team Members Section */}
      <div className="space-y-4 pt-4">
        {/* Team Header */}
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">
            Team members
          </h2>
          <p className="text-sm text-muted-foreground tracking-[-0.084px]">
            Manage access to the organization
          </p>
        </div>

        {/* Search and Invite Section */}
        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search member"
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
              Add member
            </Button>
          )}
        </div>

        {/* Members Table */}
        <MemberTable
          members={members || []}
          sortOrder={sortOrder}
          memberContext={memberContext}
          onSortChange={(newSortOrder) => {
            setSortOrder(newSortOrder);
          }}
        />
      </div>

      {/* Add Member Dialog */}
      <AddMemberDialog
        organizationId={organization?._id as string}
        open={isAddMemberDialogOpen}
        onOpenChange={setIsAddMemberDialogOpen}
      />
    </div>
  );
}
