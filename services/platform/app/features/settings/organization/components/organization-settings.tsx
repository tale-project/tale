'use client';

import { Button } from '@tale/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';

import { CopyableField } from '@/app/components/ui/data-display/copyable-field';
import { Form } from '@/app/components/ui/forms/form';
import { Input } from '@/app/components/ui/forms/input';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { Select } from '@/app/components/ui/forms/select';
import { ActionRow } from '@/app/components/ui/layout/action-row';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { useDebounce } from '@/app/hooks/use-debounce';
import { useToast } from '@/app/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { SUPPORTED_AGENT_LOCALES } from '@/lib/shared/constants/agents';
import { getOrganizationDefaultLocale } from '@/lib/shared/utils/get-organization-default-locale';

import type { Member } from '../hooks/queries';
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
  organization: { _id: string; name: string; metadata?: unknown } | null;
  memberContext: MemberContext | null;
}

interface OrganizationFormData {
  name: string;
  defaultLocale: string;
}

function parseMetadata(metadata: unknown): {
  defaultLocale?: string;
  [key: string]: unknown;
} {
  let parsed = metadata;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (e) {
      console.warn('Failed to parse organization metadata', e);
      return {};
    }
  }
  if (!parsed || typeof parsed !== 'object') return {};
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata is validated above
  return parsed as { defaultLocale?: string; [key: string]: unknown };
}

export function OrganizationSettings({
  organization,
  memberContext,
}: OrganizationSettingsProps) {
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const { t: tGlobal } = useT('global');
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false);
  const { toast } = useToast();

  const debouncedSearch = useDebounce(searchQuery, 300);

  const existingMetadata = parseMetadata(organization?.metadata);

  const localeOptions = useMemo(
    () =>
      SUPPORTED_AGENT_LOCALES.map((locale) => ({
        value: locale,
        label: tGlobal(`languages.${locale}`),
      })),
    [tGlobal],
  );

  const form = useForm<OrganizationFormData>({
    mode: 'onChange',
    defaultValues: {
      name: organization?.name || '',
      defaultLocale: getOrganizationDefaultLocale(organization?.metadata),
    },
  });

  const { formState, handleSubmit, register, reset, setValue, watch } = form;
  const { isSubmitting, isDirty } = formState;
  const defaultLocale = watch('defaultLocale');

  const { members: allMembers, isLoading: isMembersLoading } = useMembers(
    organization?._id ?? '',
  );

  const members = useMemo(() => {
    if (!allMembers) return null;
    const search = debouncedSearch?.toLowerCase();
    let filtered = allMembers;
    if (search) {
      filtered = filtered.filter(
        (member: Member) =>
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
      const updatedMetadata = {
        ...existingMetadata,
        defaultLocale: data.defaultLocale,
      };
      await authClient.organization.update({
        organizationId: organization._id,
        data: {
          name: data.name.trim() || undefined,
          metadata: updatedMetadata,
        },
      });

      // The Better Auth session carries the org's metadata (including
      // `defaultLocale`), which agent write-boundary normalization and the
      // chat pipeline read. Invalidate it so in-flight tabs pick up the new
      // locale without a reload.
      await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });

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
      <PageSection
        title={tSettings('organization.detailsTitle')}
        description={tSettings('organization.detailsDescription')}
      >
        <Form onSubmit={handleSubmit(onSubmit)} className="space-y-0">
          <HStack
            gap={3}
            align="end"
            justify="between"
            className="sticky bottom-0 z-40"
          >
            <Input
              id="org-name"
              label={tSettings('organization.title')}
              {...register('name')}
              wrapperClassName="max-w-sm flex-1"
            />
            {isDirty && (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? tCommon('actions.saving')
                  : tCommon('actions.saveChanges')}
              </Button>
            )}
          </HStack>

          <div className="mt-4 max-w-sm">
            <Select
              id="default-locale"
              label={tSettings('organization.defaultLocale')}
              value={defaultLocale}
              onValueChange={(value) =>
                setValue('defaultLocale', value, { shouldDirty: true })
              }
              disabled={isSubmitting}
              options={localeOptions}
            />

            {organization && (
              <div className="mt-4 max-w-sm">
                <CopyableField
                  value={organization._id}
                  label={tSettings('organization.organizationId')}
                  copyAriaLabel={tSettings('organization.copyOrganizationId')}
                />
              </div>
            )}
          </div>
        </Form>
      </PageSection>

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
            wrapperClassName="flex-1 max-w-sm"
          />
          {memberContext?.isAdmin && (
            <Button onClick={() => setIsAddMemberDialogOpen(true)}>
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
