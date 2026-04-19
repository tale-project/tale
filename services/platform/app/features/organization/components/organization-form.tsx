'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMutation } from 'convex/react';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Form } from '@/app/components/ui/forms/form';
import { Input } from '@/app/components/ui/forms/input';
import { VStack, Center } from '@/app/components/ui/layout/layout';
import { TaleLogo } from '@/app/components/ui/logo/tale-logo';
import { Button } from '@/app/components/ui/primitives/button';
import { Heading } from '@/app/components/ui/typography/heading';
import { UserButton } from '@/app/components/user-button';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';

import { useInitializeDefaultWorkflows } from '../hooks/actions';

type FormData = { name: string };

export function OrganizationForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const recordOrgSwitch = useMutation(
    api.organizations.record_org_switch.recordOrgSwitch,
  );
  const { user } = useAuth();
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  // slug is derived from name via lowercasing + replacing non-alphanumerics
  // with hyphens; it's used as a filesystem path component (/examples/{slug}/)
  // and must match file_io.ts ORG_SLUG_REGEX: /^[a-z0-9][a-z0-9_-]*$/.
  // So the name must contain at least one ASCII letter or digit; pure-CJK or
  // pure-symbol names would produce an empty slug and fail at creation.
  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(1, t('organization.companyNameRequired'))
          .regex(
            /^[A-Za-z0-9][A-Za-z0-9 _-]*$/,
            'Use letters, digits, spaces, hyphens, and underscores only, starting with a letter or digit.',
          ),
      }),
    [t],
  );

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
      name: '',
    },
  });

  const nameValue = form.watch('name');
  const slugPreview = nameValue
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const { mutateAsync: initializeDefaultWorkflows } =
    useInitializeDefaultWorkflows();

  const handleSubmit = form.handleSubmit(async (data) => {
    if (!user) {
      return;
    }

    try {
      const slug = data.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      const result = await authClient.organization.create({
        name: data.name.trim(),
        slug: slug,
        metadata: { creatorId: user.userId },
      });

      const newOrgId = result?.data?.id;
      if (newOrgId) {
        await authClient.organization.setActive({
          organizationId: newOrgId,
        });
        // Invalidate the TanStack-cached session (5-min stale) so downstream
        // route guards see the fresh activeOrganizationId.
        await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });

        await initializeDefaultWorkflows({
          organizationId: newOrgId,
        });

        try {
          await recordOrgSwitch({ organizationId: newOrgId });
        } catch (err) {
          console.warn('Failed to record org switch audit entry:', err);
        }
      }

      toast({
        title: t('organization.organizationCreated'),
        variant: 'success',
      });

      // Navigate directly to the new org's dashboard. Without the explicit
      // id, /dashboard would re-run the picker for users with 2+ orgs.
      if (newOrgId) {
        void navigate({ to: '/dashboard/$id', params: { id: newOrgId } });
      } else {
        void navigate({ to: '/dashboard' });
      }
    } catch (error) {
      console.error('Error in organization creation:', error);
      toast({
        title: tCommon('errors.unexpectedError'),
        variant: 'destructive',
      });
    }
  });

  return (
    <div className="flex h-screen flex-col">
      <header className="mx-auto flex w-full items-center justify-between px-4 py-3">
        <TaleLogo />
        <UserButton align="end" />
      </header>
      <Center className="flex-1 items-start px-4 py-16 pt-[15vh]">
        <VStack className="w-full max-w-[24rem]">
          <Heading level={1} className="mb-8 text-center">
            {t('organization.createOrganization')}
          </Heading>
          <Form onSubmit={handleSubmit}>
            <Input
              id="org-name"
              type="text"
              label={t('organization.organizationName')}
              required
              {...form.register('name')}
              placeholder={t('organization.enterCompanyName')}
              disabled={form.formState.isSubmitting}
              errorMessage={form.formState.errors.name?.message}
              description={
                slugPreview ? `Identifier: ${slugPreview}` : undefined
              }
            />
            <Button
              type="submit"
              fullWidth
              disabled={form.formState.isSubmitting || !form.formState.isValid}
            >
              {form.formState.isSubmitting
                ? t('organization.creating')
                : tCommon('actions.create')}
            </Button>
          </Form>
        </VStack>
      </Center>
    </div>
  );
}
