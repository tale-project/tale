'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
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
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { invalidateAuthState } from '@/app/lib/auth/session-query';
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

interface OrganizationFormData {
  name: string;
  defaultLocale: string;
}

type OrganizationController = ReturnType<
  typeof useFormEditor<OrganizationFormData>
>;

/**
 * A rejected organization update, normalized into the editor save contract:
 * `message` is the translated line the `EditorActions` cluster shows in its one
 * destructive toast, while `serverMessage` keeps the raw Better Auth text so
 * `mapServerError` can decide whether the failure belongs under a field
 * instead.
 */
class OrganizationUpdateError extends Error {
  readonly serverMessage: string;

  constructor(message: string, serverMessage: string) {
    super(message);
    this.name = 'OrganizationUpdateError';
    this.serverMessage = serverMessage;
  }
}

// The auth layer re-runs the shared organization-name guard on every update
// (`beforeUpdateOrganization`) and rejects a cleared name with a 400 whose
// message names the field. Better Call only attaches a machine-readable `code`
// to its own validation errors, so that text is the only signal the client
// gets — and it decides purely WHERE the failure is shown. What the user reads
// is always the translated field message.
const NAME_REJECTION_PATTERN = /organization name/i;

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
  canDelete,
  isCurrentOrganization,
}: {
  controller: OrganizationController;
  organization: Organization;
  organizationId: string;
  /** Owner of a non-default org — gates the danger zone. */
  canDelete: boolean;
  /** Whether this is the org the user is currently viewing (drives post-delete nav). */
  isCurrentOrganization: boolean;
}) {
  const { t: tSettings } = useT('settings');
  const { t: tGlobal } = useT('global');

  const { form, isLoading, isSaving, submit } = controller;
  const {
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
      {/* Shared settings-field list: each field is a row with its label +
          helper text on the left and the control pinned right, divided from
          its neighbours. The form (name + locale) and the read-only
          Organization ID share one list so they read as one continuous block;
          Save/Discard live in the settings header via the registered
          editor. */}
      <SettingsSection
        title={tSettings('organization.detailsTitle')}
        description={tSettings('organization.detailsDescription')}
      >
        {/* Submit through the controller, never `form.handleSubmit(save)`:
            that second path would skip the dirty-baseline reset and the
            server-error mapping the header's Save button gets. */}
        <Form id="organization-form" onSubmit={submit}>
          <fieldset disabled={isLoading} className="contents">
            <SettingsFieldList>
              <SettingsFieldRow
                label={tSettings('organization.title')}
                description={tSettings('organization.nameDescription')}
                required
              >
                {/* `wrapperClassName="w-full"` lets the bare Input fill the
                    row's control column so its skeleton mask matches the
                    loaded width. */}
                <Input
                  id="org-name"
                  aria-label={tSettings('organization.title')}
                  required
                  errorMessage={errors.name?.message}
                  {...register('name')}
                  wrapperClassName="w-full"
                />
              </SettingsFieldRow>

              <SettingsFieldRow
                label={tSettings('organization.defaultLocale')}
                description={tSettings('organization.localeDescription')}
              >
                {/* Controlled via RHF `Controller`: the field registers itself
                    so dirty tracking is automatic (no `setValue(...,
                    { shouldDirty })` to forget). `field.value ?? ''` keeps
                    Radix controlled from the first render before the form
                    resets to server data. */}
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
              </SettingsFieldRow>

              <SettingsFieldRow
                label={tSettings('organization.organizationId')}
                description={tSettings(
                  'organization.organizationIdDescription',
                )}
              >
                <CopyableField
                  value={organization?._id ?? ''}
                  copyAriaLabel={tSettings('organization.copyOrganizationId')}
                />
              </SettingsFieldRow>
            </SettingsFieldList>
          </fieldset>
        </Form>
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
      <Alert variant="destructive" live="off" icon={AlertTriangle}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <Stack gap={1} className="max-w-2xl min-w-0">
            <span className="text-foreground text-sm leading-none font-medium">
              {tSettings('organization.deleteDialogTitle')}
            </span>
            <span className="text-sm leading-relaxed">
              {tSettings('organization.deleteSectionHelp')}
            </span>
          </Stack>
          <Button
            type="button"
            variant="destructive"
            className="shrink-0 self-end sm:self-auto"
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
// Container — owns data fetching, the form controller, the save call, the
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

  // Save feedback belongs to the `EditorActions` cluster in the settings
  // header: it flashes "Saved" on success and raises the single destructive
  // toast on failure. So this only persists and, when the round-trip fails,
  // throws the translated line for the cluster to show.
  const save = useCallback(
    async (data: OrganizationFormData) => {
      if (!organization) return;
      const updatedMetadata = {
        ...existingMetadata,
        defaultLocale: data.defaultLocale,
      };
      try {
        const result = await authClient.organization.update({
          organizationId: organization._id,
          data: {
            name: data.name.trim(),
            metadata: updatedMetadata,
          },
        });
        // Better Auth resolves with `{ error }` rather than rejecting, so an
        // update the server refused has to be raised here or it would read as
        // a clean save — form clean, "Saved" flashed, nothing persisted.
        if (result?.error) {
          throw new Error(result.error.message ?? 'Organization update failed');
        }
        await invalidateAuthState(queryClient);
      } catch (error) {
        console.error('Failed to update organization', error);
        throw new OrganizationUpdateError(
          tToast('error.organizationUpdateFailed.title'),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [existingMetadata, organization, queryClient, tToast],
  );

  // A name the server refused belongs under the name input, not in a toast —
  // returning issues here routes it through `form.setError` and suppresses the
  // toast entirely.
  const mapServerError = useCallback(
    (err: unknown) => {
      if (
        err instanceof OrganizationUpdateError &&
        NAME_REJECTION_PATTERN.test(err.serverMessage)
      ) {
        return [
          { path: 'name', message: tSettings('organization.nameRequired') },
        ];
      }
      return null;
    },
    [tSettings],
  );

  const editor = useFormEditor<OrganizationFormData>({
    data: initialData,
    schema: organizationSchema,
    save,
    mapServerError,
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
    <Skeletonize loading={abilityLoading || isOrgLoading}>
      <OrganizationSettingsView
        controller={editor}
        organization={organization ?? null}
        organizationId={organizationId}
        canDelete={canDelete}
        // The settings route is always scoped to the org the user is currently
        // in (`/dashboard/$id/...`), so deleting it must route them elsewhere.
        isCurrentOrganization
      />
    </Skeletonize>
  );
}
