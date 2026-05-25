'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { CopyableField } from '@/app/components/ui/data-display/copyable-field';
import {
  useFormEditor,
  useRegisterActiveEditor,
} from '@/app/components/ui/editor';
import { Form } from '@/app/components/ui/forms/form';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useToast } from '@/app/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { SUPPORTED_AGENT_LOCALES } from '@/lib/shared/constants/agents';
import { getOrganizationDefaultLocale } from '@/lib/shared/utils/get-organization-default-locale';

interface OrganizationSettingsProps {
  organization: { _id: string; name: string; metadata?: unknown } | null;
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
}: OrganizationSettingsProps) {
  const { t: tSettings } = useT('settings');
  const { t: tNav } = useT('navigation');
  const { t: tToast } = useT('toast');
  const { t: tGlobal } = useT('global');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const existingMetadata = useMemo(
    () => parseMetadata(organization?.metadata),
    [organization?.metadata],
  );

  const localeOptions = useMemo(
    () =>
      SUPPORTED_AGENT_LOCALES.map((locale) => ({
        value: locale,
        label: tGlobal(`languages.${locale}`),
      })),
    [tGlobal],
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

  const { form, isLoading } = editor;
  const { handleSubmit, register, setValue, watch } = form;
  const defaultLocale = watch('defaultLocale');

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
          onSubmit={handleSubmit((values) => save(values))}
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
              disabled={editor.isSaving || isLoading}
              options={localeOptions}
              wrapperClassName="max-w-sm"
            />
          </fieldset>
        </Form>
      </SettingsSection>

      {organization && (
        <SettingsSection
          title={tSettings('organization.identifiersTitle')}
          description={tSettings('organization.identifiersDescription')}
        >
          <CopyableField
            label={tSettings('organization.organizationId')}
            description={tSettings('organization.organizationIdDescription')}
            value={organization._id}
            copyAriaLabel={tSettings('organization.copyOrganizationId')}
            className="max-w-sm"
          />
        </SettingsSection>
      )}
    </SettingsPage>
  );
}
