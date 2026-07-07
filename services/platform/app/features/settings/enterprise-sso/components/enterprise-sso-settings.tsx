'use client';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { useEnterpriseSso } from '../hooks/use-enterprise-sso';
import {
  EnterpriseSsoForm,
  type EnterpriseSsoConfig,
} from './enterprise-sso-form';

/**
 * Dedicated "Enterprise SSO" settings page — sign-in (OIDC/OAuth2/SAML) +
 * SCIM provisioning for the org, with per-provider setup guidance. Admin-gated
 * (`orgSettings`), matching the config mutations' `isAdmin` requirement.
 */
export function EnterpriseSsoSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t: tAccessDenied } = useT('accessDenied');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const { data } = useEnterpriseSso(organizationId);
  // `undefined` while the query is loading; the form shows its loading state.
  const config: EnterpriseSsoConfig | undefined = data;

  if (!abilityLoading && ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccessDenied('enterpriseSso')} />;
  }

  // The form owns the page's `SettingsSection`s (title/description included)
  // so the section rhythm matches the other settings pages.
  return (
    <SettingsPage>
      <EnterpriseSsoForm organizationId={organizationId} config={config} />
    </SettingsPage>
  );
}
