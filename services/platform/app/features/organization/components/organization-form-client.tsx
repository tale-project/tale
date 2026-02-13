'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Form } from '@/app/components/ui/forms/form';
import { Input } from '@/app/components/ui/forms/input';
import { VStack, Center } from '@/app/components/ui/layout/layout';
import { TaleLogo } from '@/app/components/ui/logo/tale-logo';
import { Button } from '@/app/components/ui/primitives/button';
import { UserButton } from '@/app/components/user-button';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { toast } from '@/app/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';

import { useInitializeDefaultWorkflows } from '../hooks/actions';

type FormData = { name: string };

export function OrganizationFormClient() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  const formSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t('organization.companyNameRequired')),
      }),
    [t],
  );

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
    },
  });

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
      });

      if (result?.data?.id) {
        await authClient.organization.setActive({
          organizationId: result.data.id,
        });

        await initializeDefaultWorkflows({
          organizationId: result.data.id,
        });
      }

      toast({
        title: t('organization.organizationCreated'),
        variant: 'success',
      });

      void navigate({ to: '/dashboard' });
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
          <h1 className="mb-8 text-center text-base font-semibold">
            {t('organization.createOrganization')}
          </h1>
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
