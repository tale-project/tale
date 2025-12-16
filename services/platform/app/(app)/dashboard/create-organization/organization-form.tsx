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

const formSchema = z.object({
  name: z.string().min(1, 'Company name is required'),
});

type FormData = z.infer<typeof formSchema>;

export default function OrganizationForm() {
  const router = useRouter();
  const { user } = useAuth();

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
        title: 'Organization created successfully!',
        variant: 'success',
      });

      router.push(`/dashboard`);
    } catch (error) {
      console.error('Error in organization creation:', error);
      toast({
        title: 'An unexpected error occurred. Please try again.',
        variant: 'destructive',
      });
    }
  });

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-[24rem]">
        <h1 className="text-base text-center font-semibold mb-8">
          Create organization
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label required htmlFor="org-name">
              Organization name
            </Label>
            <Input
              id="org-name"
              type="text"
              className="mt-2"
              {...form.register('name')}
              placeholder="Enter your company name"
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
            {form.formState.isSubmitting ? 'Creating...' : 'Create'}
          </Button>
        </form>
      </div>
    </div>
  );
}
