'use client';

import { Skeletonize } from '@tale/ui/skeleton-context';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { EmbeddingSection } from '@/app/features/settings/trusted-headers/components/embedding-section';
import { TrustedHeadersSection } from '@/app/features/settings/trusted-headers/components/trusted-headers-section';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { useEnterpriseSso } from '../hooks/use-enterprise-sso';
import {
  EnterpriseSsoForm,
  type EnterpriseSsoConfig,
} from './enterprise-sso-form';

/**
 * Dedicated "Enterprise SSO" settings page — sign-in (OIDC/OAuth2/SAML) +
 * SCIM provisioning for the org, with per-provider setup guidance, plus the
 * trusted-headers card (an application's authenticating proxy signing its
 * users in with the organization's key). Admin-gated (`orgSettings`),
 * matching the config mutations' `isAdmin` requirement.
 */
export function EnterpriseSsoSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t: tAccessDenied } = useT('accessDenied');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const { data, isLoading } = useEnterpriseSso(organizationId);
  // `undefined` while the query is loading; the form shows its loading state.
  const config: EnterpriseSsoConfig | undefined = data;

  if (!abilityLoading && ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccessDenied('enterpriseSso')} />;
  }

  // The form owns the page's `SettingsSection`s (title/description included)
  // so the section rhythm matches the other settings pages.
  return (
    <SettingsPage>
      {/* Masked in place while the connection loads, like every other
          settings editor — not a form of empty fields that fill in later. */}
      <Skeletonize loading={abilityLoading || isLoading}>
        <EnterpriseSsoForm organizationId={organizationId} config={config} />
      </Skeletonize>
      <TrustedHeadersSection organizationId={organizationId} />
      <EmbeddingSection organizationId={organizationId} />
    </SettingsPage>
  );
}
