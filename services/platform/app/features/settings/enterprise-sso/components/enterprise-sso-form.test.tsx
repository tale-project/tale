import { describe, it, vi } from 'vitest';

import type { SsoConnectionView } from '@/lib/shared/schemas/enterprise_sso';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { EnterpriseSsoForm } from './enterprise-sso-form';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/use-enterprise-sso', () => {
  const stub = () => ({
    mutateAsync: vi.fn(),
    mutate: vi.fn(),
    isPending: false,
  });
  return {
    useUpsertOidc: stub,
    useUpsertSaml: stub,
    useSetProvisioning: stub,
    useTestSsoConnection: stub,
    useRevealOidcClientId: stub,
    useDisableSso: stub,
    useRemoveSso: stub,
    useRegenerateScimToken: stub,
    useSetScimDefaultRole: stub,
    useDisableScim: stub,
  };
});

const connectedOidc: SsoConnectionView = {
  configured: true,
  enabled: true,
  protocol: 'oidc',
  displayName: 'Acme SSO',
  domain: 'acme.com',
  oidc: {
    providerId: 'entra-id',
    issuer: 'https://login.microsoftonline.com/tid/v2.0',
    scopes: ['openid', 'email', 'profile'],
    pkce: false,
  },
  saml: null,
  provisioning: {
    autoProvisionRole: true,
    defaultRole: 'member',
    roleMappingRules: [],
    autoProvisionTeam: true,
    excludeGroups: [],
  },
  scim: {
    enabled: true,
    tokenPrefix: 'scim_1a2b3c4d…',
    tokenGeneratedAt: 1_700_000_000_000,
    lastUsedAt: null,
    baseUrl: 'https://app.example.com/scim/v2',
  },
  samlSpMetadataUrl: 'https://app.example.com/api/sso/saml/metadata',
  samlAcsUrl: 'https://app.example.com/api/sso/saml/acs',
  oidcCallbackUrl: 'https://app.example.com/api/sso/callback',
};

const samlConfig: SsoConnectionView = {
  ...connectedOidc,
  protocol: 'saml',
  oidc: null,
  saml: {
    idpEntityId: 'https://idp.example.com/entity',
    idpSsoUrl: 'https://idp.example.com/sso',
    idpCertificate:
      '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
    hasSpKeypair: false,
  },
};

describe('EnterpriseSsoForm accessibility', () => {
  it('passes axe when unconfigured (defaults to OIDC)', async () => {
    const { container } = render(
      <EnterpriseSsoForm organizationId="org-1" config={null} />,
    );
    await checkAccessibility(container);
  });

  it('passes axe with a connected OIDC + SCIM connection', async () => {
    const { container } = render(
      <EnterpriseSsoForm organizationId="org-1" config={connectedOidc} />,
    );
    await checkAccessibility(container);
  });

  it('passes axe with a SAML connection', async () => {
    const { container } = render(
      <EnterpriseSsoForm organizationId="org-1" config={samlConfig} />,
    );
    await checkAccessibility(container);
  });
});
