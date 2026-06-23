'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from 'convex/react';
import { useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { WizardStep } from '@/app/components/ui/wizard/wizard';
import { useInitializeDefaultWorkflows } from '@/app/features/organization/hooks/actions';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { MAX_ORG_SLUG_LENGTH } from '@/lib/shared/constants/org-slug';
import { isReservedOrgSlug } from '@/lib/shared/constants/reserved-org-slugs';
import { clampToSupportedLocale } from '@/lib/shared/utils/get-organization-default-locale';

/**
 * Derive the on-disk slug from a free-form display name. Mirrors
 * `services/platform/lib/shared/constants/org-slug.ts` ORG_SLUG_REGEX and
 * truncates to the shared cap so a long name can't mint a slug the
 * RAG/crawler validators would reject.
 */
function deriveOrgSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ORG_SLUG_LENGTH);
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;

/** Base language subtag of a locale (e.g. `en-US` → `en`). */
function baseLanguage(locale: string): string {
  try {
    return new Intl.Locale(locale).language ?? locale;
  } catch (error) {
    console.warn('Failed to parse locale tag:', locale, error);
    return locale;
  }
}

interface WorkspaceStepProps {
  /** Already-created org id (set once the workspace exists) — keeps the input
   *  disabled and the step idempotent if the user steps back into it. */
  createdOrgId: string | null;
  /** Lifts the new org id so later steps (provider, finish) can use it. */
  onCreated: (organizationId: string) => void;
}

export function WorkspaceStep({ createdOrgId, onCreated }: WorkspaceStepProps) {
  const { user } = useAuth();
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const { locale } = useLocale();

  const recordOrgSwitch = useMutation(
    api.organizations.record_org_switch.recordOrgSwitch,
  );
  const { mutateAsync: initializeDefaultWorkflows } =
    useInitializeDefaultWorkflows();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  // We don't ask for an organization language: assume the owner shares a
  // language with the organization, so adopt their detected client/browser
  // locale (clamped to a supported one). Persisted as the org's `defaultLocale`
  // and used to seed the prompt library in that language; changeable later in
  // organization settings.
  const orgLocale = clampToSupportedLocale(baseLanguage(locale));

  const trimmed = name.trim();
  const slug = deriveOrgSlug(name);
  const nameValid =
    trimmed.length > 0 &&
    NAME_PATTERN.test(trimmed) &&
    !isReservedOrgSlug(slug);

  const nameError =
    trimmed.length === 0
      ? undefined
      : !NAME_PATTERN.test(trimmed)
        ? tSettings('organization.companyNameCharacterError')
        : isReservedOrgSlug(slug)
          ? tSettings('organization.nameReserved')
          : undefined;

  const createWorkspace = async (): Promise<boolean> => {
    if (createdOrgId) return true;
    // The websocket may still be authenticating right after sign-up; the
    // current user isn't available yet. Stay on the step so the user can
    // retry once auth settles (Next is also gated on `user` via `valid`).
    if (!user) return false;
    try {
      const result = await authClient.organization.create({
        name: trimmed,
        slug,
        metadata: { creatorId: user.userId, defaultLocale: orgLocale },
      });
      const newOrgId = result?.data?.id;
      if (!newOrgId) throw new Error('Organization id missing from response');

      await authClient.organization.setActive({ organizationId: newOrgId });
      await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
      await initializeDefaultWorkflows({ organizationId: newOrgId });
      try {
        await recordOrgSwitch({ organizationId: newOrgId });
      } catch (err) {
        console.warn('Failed to record org switch audit entry:', err);
      }

      onCreated(newOrgId);
      toast({
        title: tSettings('organization.organizationCreated'),
        variant: 'success',
      });
      return true;
    } catch (error) {
      console.error('Error creating organization:', error);
      toast({
        title: tCommon('errors.unexpectedError'),
        variant: 'destructive',
      });
      return false;
    }
  };

  return (
    <WizardStep
      id="workspace"
      valid={nameValid && Boolean(user)}
      onBeforeNext={createWorkspace}
    >
      <Input
        id="org-name"
        type="text"
        label={tSettings('organization.organizationName')}
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={tSettings('organization.enterCompanyName')}
        errorMessage={nameError}
        disabled={Boolean(createdOrgId)}
      />
    </WizardStep>
  );
}
