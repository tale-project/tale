'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { VStack, Center } from '@tale/ui/layout';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMutation } from 'convex/react';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Form } from '@/app/components/ui/forms/form';
import { Input } from '@/app/components/ui/forms/input';
import { TaleLogo } from '@/app/components/ui/logo/tale-logo';
import { UserButton } from '@/app/components/user-button';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { MAX_ORG_SLUG_LENGTH } from '@/lib/shared/constants/org-slug';
import { isReservedOrgSlug } from '@/lib/shared/constants/reserved-org-slugs';

import { useInitializeDefaultWorkflows } from '../hooks/actions';

type FormData = { name: string };

/**
 * Derive the on-disk slug from a free-form display name.
 *
 * Three call sites used to inline the same chain; the helper keeps the
 * derivation rule in one place so the live preview, the Zod refine,
 * and the submit payload can never drift.
 *
 * Must produce a slug that matches
 * `services/platform/lib/shared/constants/org-slug.ts` ORG_SLUG_REGEX —
 * see `assertValidOrgSlug`. Truncates to `MAX_ORG_SLUG_LENGTH` so a
 * long display name doesn't mint a slug that RAG/crawler's Python
 * validator (capped at 64 chars) would reject — that path causes
 * total feature loss for the org with no recovery.
 */
function deriveOrgSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ORG_SLUG_LENGTH);
}

export function OrganizationForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const recordOrgSwitch = useMutation(
    api.organizations.record_org_switch.recordOrgSwitch,
  );
  const { user } = useAuth();
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  // slug is derived from name via `deriveOrgSlug`; it's used as a
  // filesystem path component (`$TALE_CONFIG_DIR/<slug>/...`) and
  // must match the canonical ORG_SLUG_REGEX. Pure-CJK / pure-symbol
  // names would produce an empty slug and fail at creation; the
  // regex check below rejects them up front.
  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(1, t('organization.companyNameRequired'))
          .regex(
            /^[A-Za-z0-9][A-Za-z0-9 _-]*$/,
            t('organization.companyNameCharacterError'),
          )
          .refine((name) => !isReservedOrgSlug(deriveOrgSlug(name)), {
            message: t('organization.nameReserved'),
          }),
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
  const slugPreview = deriveOrgSlug(nameValue);

  const { mutateAsync: initializeDefaultWorkflows } =
    useInitializeDefaultWorkflows();

  const handleSubmit = form.handleSubmit(async (data) => {
    if (!user) {
      return;
    }

    try {
      const slug = deriveOrgSlug(data.name);

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
                slugPreview
                  ? t('organization.identifierPreview', { slug: slugPreview })
                  : undefined
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
