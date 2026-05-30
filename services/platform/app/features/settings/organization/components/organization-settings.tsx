'use client';

import { Skeletonize } from '@tale/ui/skeleton-context';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

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
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { SUPPORTED_AGENT_LOCALES } from '@/lib/shared/constants/agents';
import { getOrganizationDefaultLocale } from '@/lib/shared/utils/get-organization-default-locale';

type Organization = { _id: string; name: string; metadata?: unknown } | null;

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
  onSave,
}: {
  controller: OrganizationController;
  organization: Organization;
  onSave: (values: OrganizationFormData) => Promise<void>;
}) {
  const { t: tSettings } = useT('settings');
  const { t: tNav } = useT('navigation');
  const { t: tGlobal } = useT('global');

  const { form, isLoading, isSaving } = controller;
  const { handleSubmit, register, setValue, watch } = form;
  const defaultLocale = watch('defaultLocale');

  const localeOptions = useMemo(
    () =>
      SUPPORTED_AGENT_LOCALES.map((locale) => ({
        value: locale,
        label: tGlobal(`languages.${locale}`),
      })),
    [tGlobal],
  );

  return (
    <SettingsPage
      title={tNav('organization')}
      description={tSettings('menu.organization.description')}
      narrow
    >
      <SettingsSection
        title={tSettings('organization.detailsTitle')}
        description={tSettings('organization.detailsDescription')}
      >
        <Form
          id="organization-form"
          onSubmit={handleSubmit((values) => onSave(values))}
        >
          <fieldset disabled={isLoading} className="contents space-y-4">
            <Input
              id="org-name"
              label={tSettings('organization.title')}
              {...register('name')}
              wrapperClassName="max-w-sm"
            />
            <Select
              id="default-locale"
              label={tSettings('organization.defaultLocale')}
              value={defaultLocale}
              onValueChange={(value) =>
                setValue('defaultLocale', value, { shouldDirty: true })
              }
              disabled={isSaving || isLoading}
              options={localeOptions}
              wrapperClassName="max-w-sm"
            />
          </fieldset>
        </Form>
      </SettingsSection>

      <SettingsSection
        title={tSettings('organization.identifiersTitle')}
        description={tSettings('organization.identifiersDescription')}
      >
        <CopyableField
          label={tSettings('organization.organizationId')}
          description={tSettings('organization.organizationIdDescription')}
          value={organization?._id ?? ''}
          copyAriaLabel={tSettings('organization.copyOrganizationId')}
          className="max-w-sm"
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
    <Skeletonize loading={abilityLoading || isOrgLoading}>
      <OrganizationSettingsView
        controller={editor}
        organization={organization ?? null}
        onSave={save}
      />
    </Skeletonize>
  );
}
