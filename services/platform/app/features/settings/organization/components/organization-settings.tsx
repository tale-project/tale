'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMutation } from 'convex/react';
import { Plus } from 'lucide-react';
import { useCallback, useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';

import { CopyableText } from '@/app/components/ui/data-display/copyable-field';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Field } from '@/app/components/ui/forms/field';
import { Form } from '@/app/components/ui/forms/form';
import { Input } from '@/app/components/ui/forms/input';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { Select } from '@/app/components/ui/forms/select';
import { ActionRow } from '@/app/components/ui/layout/action-row';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Button } from '@/app/components/ui/primitives/button';
import { useUserOrganizationsWithDetails } from '@/app/features/organization/hooks/queries';
import { useDebounce } from '@/app/hooks/use-debounce';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const recordOrgSwitch = useMutation(
    api.organizations.record_org_switch.recordOrgSwitch,
  );
  const { organizations: userOrgs } = useUserOrganizationsWithDetails();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false);
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);
  const { toast } = useToast();

  const switchToOrg = useCallback(
    async (nextOrgId: string) => {
      if (nextOrgId === organization?._id) return;
      setSwitchingOrgId(nextOrgId);
      try {
        await authClient.organization.setActive({
          organizationId: nextOrgId,
        });
        await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
        try {
          await recordOrgSwitch({ organizationId: nextOrgId });
        } catch (err) {
          console.warn('Failed to record org switch audit entry:', err);
        }
        void navigate({
          to: '/dashboard/$id/settings/organization',
          params: { id: nextOrgId },
        });
      } catch (err) {
        console.error('Failed to switch organization:', err);
        toast({
          title: 'Failed to switch organization',
          variant: 'destructive',
        });
      } finally {
        setSwitchingOrgId(null);
      }
    },
    [organization?._id, queryClient, recordOrgSwitch, navigate, toast],
  );

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
        </div>
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
        title="Your organizations"
        description="All organizations you belong to. Switch between them or create a new one."
        className="pt-4"
      >
        <Stack gap={2}>
          {(userOrgs ?? []).map((org) => {
            const isCurrent = org.organizationId === organization?._id;
            return (
              <HStack
                key={org.organizationId}
                justify="between"
                align="center"
                className="rounded-lg border px-4 py-3"
              >
                <Stack gap={1}>
                  <HStack gap={2} align="center">
                    <span className="text-sm font-medium">{org.name}</span>
                    {isCurrent && <Badge variant="green">Current</Badge>}
                  </HStack>
                  <span className="text-muted-foreground text-xs">
                    {org.slug ? `@${org.slug} · ` : ''}role: {org.role}
                  </span>
                </Stack>
                {!isCurrent && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void switchToOrg(org.organizationId)}
                    disabled={switchingOrgId === org.organizationId}
                  >
                    {switchingOrgId === org.organizationId
                      ? 'Switching…'
                      : 'Switch'}
                  </Button>
                )}
              </HStack>
            );
          })}
        </Stack>

        <HStack>
          <Button
            size="sm"
            onClick={() =>
              void navigate({ to: '/dashboard/create-organization' })
            }
          >
            <Plus className="mr-2 size-4" />
            {tSettings('organization.createOrganization')}
          </Button>
        </HStack>
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
