'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod/v4';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { CopyableField } from '@/app/components/ui/data-display/copyable-field';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import {
  useFormEditor,
  useRegisterActiveEditor,
} from '@/app/components/ui/editor';
import { Form } from '@/app/components/ui/forms/form';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { useDeleteOrganization } from '@/app/features/organization/hooks/use-delete-organization';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsRow } from '@/app/features/settings/components/settings-row';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { MembersSettings } from '@/app/features/settings/organization/components/members-settings';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useToast } from '@/app/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { SUPPORTED_AGENT_LOCALES } from '@/lib/shared/constants/agents';
import { organizationNameSchema } from '@/lib/shared/schemas/organizations';
import { getOrganizationDefaultLocale } from '@/lib/shared/utils/get-organization-default-locale';

type Organization = {
  _id: string;
  name: string;
  slug?: string;
  metadata?: unknown;
} | null;

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
// Plain presentational view — renders the full-width settings-row layout
// from an injected controller. Rendered both live and (wrapped in
// `<Skeletonize>`) as its own skeleton, so the skeleton inherits the exact
// row structure and control widths — it can't drift horizontally or
// vertically from the loaded content.
// =============================================================================
export function OrganizationSettingsView({
  controller,
  organization,
  organizationId,
  memberContext,
  canDelete,
  isCurrentOrganization,
  onSave,
}: {
  controller: OrganizationController;
  organization: Organization;
  organizationId: string;
  memberContext: MemberContext | null;
  /** Owner of a non-default org — gates the danger zone. */
  canDelete: boolean;
  /** Whether this is the org the user is currently viewing (drives post-delete nav). */
  isCurrentOrganization: boolean;
  onSave: (values: OrganizationFormData) => Promise<void>;
}) {
  const { t: tSettings } = useT('settings');
  const { t: tGlobal } = useT('global');

  const { form, isLoading, isSaving } = controller;
  const {
    handleSubmit,
    register,
    control,
    formState: { errors },
  } = form;

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
      {/* Settings-row layout: each field is a horizontal row with its
          label + helper text on the left and the control pinned right, with
          a divider between rows. The form (name + locale) and the read-only
          Organization ID share one divided list so they read as one
          continuous block; Save/Discard live in the settings header via the
          registered editor. */}
      <SettingsSection
        title={tSettings('organization.detailsTitle')}
        description={tSettings('organization.detailsDescription')}
      >
        <Form
          id="organization-form"
          onSubmit={handleSubmit((values) => onSave(values))}
        >
          <fieldset disabled={isLoading} className="divide-border divide-y">
            <SettingsRow
              className="py-5"
              label={tSettings('organization.title')}
              description={tSettings('organization.nameDescription')}
              required
            >
              {/* Fixed-width control column, full-width on mobile where the row
                stacks. `wrapperClassName="w-full"` lets the bare Input fill it
                so its skeleton mask matches the loaded width. */}
              <div className="w-full sm:w-80">
                <Input
                  id="org-name"
                  aria-label={tSettings('organization.title')}
                  required
                  errorMessage={errors.name?.message}
                  {...register('name')}
                  wrapperClassName="w-full"
                />
              </div>
            </SettingsRow>

            <SettingsRow
              className="py-5"
              label={tSettings('organization.defaultLocale')}
              description={tSettings('organization.localeDescription')}
            >
              <div className="w-full sm:w-80">
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
                      aria-label={tSettings('organization.defaultLocale')}
                      value={field.value ?? ''}
                      onValueChange={(value) => {
                        // Radix emits a spurious `onValueChange('')` while its
                        // value and options settle during cold load; drop it
                        // (`''` is never a valid locale) so it can't false-dirty
                        // the form on a page the user only opened.
                        if (!value) return;
                        field.onChange(value);
                      }}
                      disabled={isSaving || isLoading}
                      options={localeOptions}
                    />
                  )}
                />
              </div>
            </SettingsRow>

            <SettingsRow
              className="py-5"
              label={tSettings('organization.organizationId')}
              description={tSettings('organization.organizationIdDescription')}
            >
              <div className="w-full sm:w-80">
                <CopyableField
                  value={organization?._id ?? ''}
                  copyAriaLabel={tSettings('organization.copyOrganizationId')}
                />
              </div>
            </SettingsRow>
          </fieldset>
        </Form>
      </SettingsSection>

      {/* Light full-width divider marks the boundary between the
          organization-details block and the Members section — the within-block
          rows already use dividers, so without it the two groups blur together
          across the gap. `pt-8` keeps the heading off the line. */}
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

      {canDelete && (
        <DangerZoneSection
          organizationId={organizationId}
          organizationName={organization?.name ?? ''}
          isCurrentOrganization={isCurrentOrganization}
        />
      )}
    </SettingsPage>
  );
}

// =============================================================================
// Danger zone — owner-only org deletion. Split out from the view so the Convex
// wiring (`useDeleteOrganization`) only mounts when the section is shown, and
// so `OrganizationSettingsView` stays renderable without a Convex provider in
// unit tests.
// =============================================================================
function DangerZoneSection({
  organizationId,
  organizationName,
  isCurrentOrganization,
}: {
  organizationId: string;
  organizationName: string;
  isCurrentOrganization: boolean;
}) {
  const { t: tSettings } = useT('settings');
  const { deleteOrganization, isDeleting } = useDeleteOrganization();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  return (
    <SettingsSection
      title={tSettings('organization.dangerZoneTitle')}
      description={tSettings('organization.dangerZoneDescription')}
    >
      <Alert
        variant="destructive"
        live="off"
        icon={AlertTriangle}
        title={tSettings('organization.deleteDialogTitle')}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm">
            {tSettings('organization.deleteSectionHelp')}
          </span>
          <Button
            type="button"
            variant="destructive"
            className="shrink-0"
            onClick={() => setConfirmDeleteOpen(true)}
          >
            {tSettings('organization.deleteConfirmAction')}
          </Button>
        </div>
      </Alert>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => {
          if (!isDeleting) setConfirmDeleteOpen(open);
        }}
        title={tSettings('organization.deleteDialogTitle')}
        description={tSettings('organization.deleteDialogDescription', {
          name: organizationName,
        })}
        variant="destructive"
        confirmText={tSettings('organization.deleteConfirmAction')}
        loadingText={tSettings('organization.deleteLoading')}
        isLoading={isDeleting}
        onConfirm={() => {
          void deleteOrganization({
            organizationId,
            isCurrent: isCurrentOrganization,
          }).then((ok) => {
            if (ok) setConfirmDeleteOpen(false);
          });
        }}
      />
    </SettingsSection>
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
  const { t: tSettings } = useT('settings');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const organizationSchema = useMemo(
    () =>
      z.object({
        name: organizationNameSchema(tSettings('organization.nameRequired')),
        defaultLocale: z.string(),
      }),
    [tSettings],
  );

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
            name: data.name.trim(),
            metadata: updatedMetadata,
          },
        });
        await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
        toast({
          title: tToast('success.organizationUpdated.title'),
          description: tToast('success.organizationUpdated.description'),
          variant: 'success',
        });
      } catch (error) {
        console.error(error);
        toast({
          title: tToast('error.organizationUpdateFailed.title'),
          description: tToast('error.organizationUpdateFailed.description'),
          variant: 'destructive',
        });
        throw error;
      }
    },
    [existingMetadata, organization, queryClient, toast, tToast],
  );

  const editor = useFormEditor<OrganizationFormData>({
    data: initialData,
    schema: organizationSchema,
    save,
  });

  useRegisterActiveEditor(editor);

  // Deletion is owner-only and the default org can never be deleted — both are
  // also enforced server-side in `prepareOrganizationDeletion`; this just hides
  // the UI when it would always fail.
  const canDelete =
    memberContext?.role === 'owner' && organization?.slug !== 'default';

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
        canDelete={canDelete}
        // The settings route is always scoped to the org the user is currently
        // in (`/dashboard/$id/...`), so deleting it must route them elsewhere.
        isCurrentOrganization
        onSave={save}
      />
    </Skeletonize>
  );
}
