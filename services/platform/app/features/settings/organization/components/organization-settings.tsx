'use client';

import { Skeletonize } from '@tale/ui/skeleton-context';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { Controller } from 'react-hook-form';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { CopyableField } from '@/app/components/ui/data-display/copyable-field';
import {
  useFormEditor,
  useRegisterActiveEditor,
} from '@/app/components/ui/editor';
import { Form } from '@/app/components/ui/forms/form';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { MembersSettings } from '@/app/features/settings/organization/components/members-settings';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useToast } from '@/app/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { SUPPORTED_AGENT_LOCALES } from '@/lib/shared/constants/agents';
import { getOrganizationDefaultLocale } from '@/lib/shared/utils/get-organization-default-locale';

type Organization = { _id: string; name: string; metadata?: unknown } | null;

type MemberContext = {
  memberId?: string;
  organizationId?: string;
  userId?: string;
  role?: string | null;
  createdAt?: number;
  displayName?: string;
  isAdmin?: boolean;
  canManageMembers?: boolean;
};

interface OrganizationFormData {
  name: string;
  defaultLocale: string;
}

type OrganizationController = ReturnType<
  typeof useFormEditor<OrganizationFormData>
>;

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

// =============================================================================
// Plain presentational view — renders the real `SettingsPage narrow` layout
// from an injected controller. Rendered both live and (wrapped in
// `<Skeletonize>`) as its own skeleton, so the skeleton inherits the exact
// `narrow` centering and section structure — it can't drift horizontally or
// vertically from the loaded content.
// =============================================================================
export function OrganizationSettingsView({
  controller,
  organization,
  organizationId,
  memberContext,
  onSave,
}: {
  controller: OrganizationController;
  organization: Organization;
  organizationId: string;
  memberContext: MemberContext | null;
  onSave: (values: OrganizationFormData) => Promise<void>;
}) {
  const { t: tSettings } = useT('settings');
  const { t: tGlobal } = useT('global');

  const { form, isLoading, isSaving } = controller;
  const { handleSubmit, register, control } = form;

  const localeOptions = useMemo(
    () =>
      SUPPORTED_AGENT_LOCALES.map((locale) => ({
        value: locale,
        label: tGlobal(`languages.${locale}`),
      })),
    [tGlobal],
  );

  return (
    <SettingsPage>
      <SettingsSection
        title={tSettings('organization.detailsTitle')}
        description={tSettings('organization.detailsDescription')}
      >
        <Form
          id="organization-form"
          onSubmit={handleSubmit((values) => onSave(values))}
        >
          {/* `max-w-sm` lives on the field column (not each control) so the
              full-width skeleton masks resolve to the same width as the loaded
              `max-w-sm` controls — no horizontal shrink when data lands. */}
          <fieldset
            disabled={isLoading}
            className="flex max-w-sm flex-col gap-4"
          >
            <Input
              id="org-name"
              label={tSettings('organization.title')}
              {...register('name')}
            />
            {/* Controlled via RHF `Controller`: the field registers itself so
                dirty tracking is automatic (no `setValue(..., { shouldDirty })`
                to forget). `field.value ?? ''` keeps Radix controlled from the
                first render before the form resets to server data. */}
            <Controller
              control={control}
              name="defaultLocale"
              render={({ field }) => (
                <Select
                  id="default-locale"
                  label={tSettings('organization.defaultLocale')}
                  value={field.value ?? ''}
                  onValueChange={(value) => {
                    // Radix emits a spurious `onValueChange('')` while its value
                    // and options settle during cold load; drop it (`''` is
                    // never a valid locale) so it can't false-dirty the form on
                    // a page the user only opened.
                    if (!value) return;
                    field.onChange(value);
                  }}
                  disabled={isSaving || isLoading}
                  options={localeOptions}
                />
              )}
            />
          </fieldset>
        </Form>
      </SettingsSection>

      <SettingsSection
        title={tSettings('organization.identifiersTitle')}
        description={tSettings('organization.identifiersDescription')}
      >
        {/* `max-w-sm` on the wrapper (not the field) so the full-width
            skeleton mask matches the loaded field width — no shrink on load. */}
        <div className="max-w-sm">
          <CopyableField
            label={tSettings('organization.organizationId')}
            description={tSettings('organization.organizationIdDescription')}
            value={organization?._id ?? ''}
            copyAriaLabel={tSettings('organization.copyOrganizationId')}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title={tSettings('organization.membersSectionTitle')}
        description={tSettings('organization.membersDescription')}
        gap={5}
      >
        <MembersSettings
          organizationId={organizationId}
          memberContext={memberContext}
        />
      </SettingsSection>
    </SettingsPage>
  );
}

// =============================================================================
// Container — owns data fetching, the form controller, save/toast wiring, the
// access check, and the loading state. Wraps the view in `<Skeletonize>` so
// the same centered tree renders the skeleton (no horizontal shift on load).
// =============================================================================
export function OrganizationSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t: tAccessDenied } = useT('accessDenied');
  const { t: tToast } = useT('toast');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const { data: organization, isLoading: isOrgLoading } =
    useOrganization(organizationId);
  const { data: memberContext } = useCurrentMemberContext(organizationId);
  // Fold the members list into the page-level loading gate so the whole page
  // reveals in a single pass. Without this the org details resolve first and
  // unmask the top sections while the embedded members table is still showing
  // its own DataTable skeleton — the user sees one skeleton swap to a second
  // before the real content lands. Same query key as `MembersSettings`'
  // `useMembers`, so this dedupes in the query cache (no extra request) and is
  // already warmed by the route loader for an instant table on warm entry.
  const { isLoading: isMembersLoading } = useMembers(organizationId);

  const existingMetadata = useMemo(
    () => parseMetadata(organization?.metadata),
    [organization?.metadata],
  );

  const initialData = useMemo<OrganizationFormData | undefined>(() => {
    if (!organization) return undefined;
    return {
      name: organization.name || '',
      defaultLocale: getOrganizationDefaultLocale(organization.metadata),
    };
  }, [organization]);

  const save = useCallback(
    async (data: OrganizationFormData) => {
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
        await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
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
        throw error;
      }
    },
    [existingMetadata, organization, queryClient, toast, tToast],
  );

  const editor = useFormEditor<OrganizationFormData>({
    data: initialData,
    save,
  });

  useRegisterActiveEditor(editor);

  // Access is only knowable once the ability has loaded; until then the
  // skeleton stands in (no denied-flash on warm entry).
  if (!abilityLoading && ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccessDenied('organization')} />;
  }

  return (
    <Skeletonize loading={abilityLoading || isOrgLoading || isMembersLoading}>
      <OrganizationSettingsView
        controller={editor}
        organization={organization ?? null}
        organizationId={organizationId}
        memberContext={memberContext ?? null}
        onSave={save}
      />
    </Skeletonize>
  );
}
