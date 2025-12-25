'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/hooks/use-convex-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n';

type FormData = { name: string };

export default function OrganizationForm() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  const formSchema = z.object({
    name: z.string().min(1, t('organization.companyNameRequired')),
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
    },
  });

  const initializeDefaultWorkflows = useAction(
    api.organizations.initializeDefaultWorkflows,
  );

  const handleSubmit = form.handleSubmit(async (data) => {
    if (!user) {
      return;
    }

    try {
      // Generate a valid URL slug from the organization name
      const slug = data.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric characters with hyphens
        .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

      const result = await authClient.organization.create({
        name: data.name.trim(),
        slug: slug,
      });

      // Initialize default workflows for the new organization
      if (result?.data?.id) {
        // Set the newly created organization as the active organization in the session
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

      router.push(`/dashboard`);
    } catch (error) {
      console.error('Error in organization creation:', error);
      toast({
        title: tCommon('errors.unexpectedError'),
        variant: 'destructive',
      });
    }
  });

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-[24rem]">
        <h1 className="text-base text-center font-semibold mb-8">
          {t('organization.createOrganization')}
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label required htmlFor="org-name">
              {t('organization.organizationName')}
            </Label>
            <Input
              id="org-name"
              type="text"
              className="mt-2"
              {...form.register('name')}
              placeholder={t('organization.enterCompanyName')}
              disabled={form.formState.isSubmitting}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive mt-1">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={form.formState.isSubmitting || !form.formState.isValid}
          >
            {form.formState.isSubmitting ? t('organization.creating') : tCommon('actions.create')}
          </Button>
        </form>
      </div>
    </div>
  );
}
