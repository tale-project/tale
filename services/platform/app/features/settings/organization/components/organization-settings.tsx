'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';

import { CopyableField } from '@/app/components/ui/data-display/copyable-field';
import { Form } from '@/app/components/ui/forms/form';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsRow } from '@/app/features/settings/components/settings-row';
import { SettingsSaveBar } from '@/app/features/settings/components/settings-save-bar';
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
  const { isSubmitting, isDirty, isValid } = formState;
  const defaultLocale = watch('defaultLocale');

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
    <SettingsPage
      title={tNav('organization')}
      description={tSettings('menu.organization.description')}
    >
      <Form id="organization-form" onSubmit={handleSubmit(onSubmit)}>
        <SettingsSection
          title={tSettings('organization.detailsTitle')}
          description={tSettings('organization.detailsDescription')}
        >
          <Input
            id="org-name"
            label={tSettings('organization.title')}
            {...register('name')}
            wrapperClassName="max-w-sm"
          />
          <div className="max-w-sm">
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
        </SettingsSection>

        {organization && (
          <SettingsSection
            title={tSettings('organization.identifiersTitle')}
            description={tSettings('organization.identifiersDescription')}
          >
            <SettingsRow
              label={tSettings('organization.organizationId')}
              description={tSettings('organization.organizationIdDescription')}
            >
              <CopyableField
                value={organization._id}
                copyAriaLabel={tSettings('organization.copyOrganizationId')}
              />
            </SettingsRow>
          </SettingsSection>
        )}
      </Form>

      <SettingsSaveBar
        isDirty={isDirty}
        isSubmitting={isSubmitting}
        isValid={isValid}
        onDiscard={() => reset()}
        formId="organization-form"
      />
    </SettingsPage>
  );
}
