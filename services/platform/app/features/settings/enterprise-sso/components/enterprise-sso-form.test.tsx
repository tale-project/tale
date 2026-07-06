import { screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  ActiveEditorProvider,
  EditorActions,
  useActiveEditor,
} from '@/app/components/ui/editor';
import { AbilityContext } from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import type { SsoConnectionView } from '@/lib/shared/schemas/enterprise_sso';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { EnterpriseSsoForm } from './enterprise-sso-form';

const adminAbility = defineAbilityFor('admin');

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

// Capture the action mocks so individual tests can assert on them. Each hook
// returns the SAME stable mutation object so the test can read `.mutateAsync`.
// Declared via `vi.hoisted` so they exist when the hoisted `vi.mock` factory
// below runs.
const { upsertOidcMock, upsertSamlMock, testConnMock, revealClientIdMock } =
  vi.hoisted(() => ({
    upsertOidcMock: vi.fn().mockResolvedValue(null),
    upsertSamlMock: vi.fn().mockResolvedValue(null),
    testConnMock: vi.fn().mockResolvedValue({ valid: true }),
    revealClientIdMock: vi.fn().mockResolvedValue(null),
  }));

vi.mock('../hooks/use-enterprise-sso', () => {
  const stub = (mutateAsync: ReturnType<typeof vi.fn>) => () => ({
    mutateAsync,
    mutate: vi.fn(),
    isPending: false,
  });
  return {
    useUpsertOidc: stub(upsertOidcMock),
    useUpsertSaml: stub(upsertSamlMock),
    useSetProvisioning: stub(vi.fn()),
    useTestSsoConnection: stub(testConnMock),
    useRevealOidcClientId: stub(revealClientIdMock),
    useDisableSso: stub(vi.fn()),
    useRemoveSso: stub(vi.fn()),
    useRegenerateScimToken: stub(vi.fn()),
    useDisableScim: stub(vi.fn()),
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

/** A SAML connection carrying an SP keypair + assertion/attribute options the
 *  form has no inputs for — used to assert they survive an unrelated re-save. */
const samlWithSpKeypair: SsoConnectionView = {
  ...samlConfig,
  saml: {
    idpEntityId: 'https://idp.example.com/entity',
    idpSsoUrl: 'https://idp.example.com/sso',
    idpCertificate:
      '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
    spCertificate:
      '-----BEGIN CERTIFICATE-----\nSPCERT\n-----END CERTIFICATE-----',
    wantAssertionsSigned: true,
    wantAssertionsEncrypted: false,
    attributeMappings: { email: 'mail' },
    hasSpKeypair: true,
  },
};

/** A stored OAuth2 connection with explicit endpoints (no OIDC discovery). */
const oauth2Config: SsoConnectionView = {
  ...connectedOidc,
  protocol: 'oauth2',
  oidc: {
    providerId: 'oauth2',
    issuer: 'https://auth.acme.com',
    authorizationEndpoint: 'https://auth.acme.com/authorize',
    tokenEndpoint: 'https://auth.acme.com/token',
    userinfoEndpoint: 'https://auth.acme.com/userinfo',
    scopes: ['openid', 'email'],
    pkce: true,
  },
  saml: null,
};

/** An unconfigured-but-loaded connection view (the backend default). */
const unconfigured: SsoConnectionView = {
  configured: false,
  enabled: false,
  protocol: null,
  displayName: null,
  domain: null,
  oidc: null,
  saml: null,
  provisioning: {
    autoProvisionRole: false,
    defaultRole: 'member',
    roleMappingRules: [],
    autoProvisionTeam: false,
    excludeGroups: [],
  },
  scim: {
    enabled: false,
    tokenPrefix: null,
    tokenGeneratedAt: null,
    lastUsedAt: null,
    baseUrl: null,
  },
  samlSpMetadataUrl: null,
  samlAcsUrl: null,
  oidcCallbackUrl: null,
};

/**
 * Renders the form alongside the header Save/Discard cluster (driven by the
 * active-editor registry the form registers into), under an admin ability so
 * the editable fieldset + Save button are present. Mirrors how the settings
 * layout wires the editor into the page header.
 */
function HeaderSlot() {
  const controller = useActiveEditor();
  if (!controller) return null;
  return <EditorActions controller={controller} entityKind="settings" />;
}

function renderForm(config: SsoConnectionView | undefined) {
  return render(
    <AbilityContext.Provider value={adminAbility}>
      <ActiveEditorProvider>
        <HeaderSlot />
        <EnterpriseSsoForm organizationId="org-1" config={config} />
      </ActiveEditorProvider>
    </AbilityContext.Provider>,
  );
}

function Bare({ children }: { children: ReactNode }) {
  return (
    <AbilityContext.Provider value={adminAbility}>
      <ActiveEditorProvider>{children}</ActiveEditorProvider>
    </AbilityContext.Provider>
  );
}

describe('EnterpriseSsoForm accessibility', () => {
  it('passes axe when unconfigured (defaults to OIDC)', async () => {
    const { container } = render(
      <Bare>
        <EnterpriseSsoForm organizationId="org-1" config={unconfigured} />
      </Bare>,
    );
    await checkAccessibility(container);
  });

  it('passes axe with a connected OIDC + SCIM connection', async () => {
    const { container } = render(
      <Bare>
        <EnterpriseSsoForm organizationId="org-1" config={connectedOidc} />
      </Bare>,
    );
    await checkAccessibility(container);
  });

  it('passes axe with a SAML connection', async () => {
    const { container } = render(
      <Bare>
        <EnterpriseSsoForm organizationId="org-1" config={samlConfig} />
      </Bare>,
    );
    await checkAccessibility(container);
  });
});

describe('EnterpriseSsoForm validation + save', () => {
  it('blocks save and shows an inline error when a required field is empty', async () => {
    const { user } = renderForm(unconfigured);

    // Clear the required display name → the schema marks the form invalid.
    const displayName = screen.getByLabelText(/display name/i);
    await user.clear(displayName);

    const saveButton = await screen.findByRole('button', { name: /^save$/i });

    // `isValid` gates the Save button regardless of validation timing, so it
    // disables as soon as the field is empty.
    await waitFor(() => {
      expect(saveButton).toBeDisabled();
    });

    // Blur the field so the inline error surfaces (shared `mode: 'onTouched'`
    // default, #1943 — the error does not render on the first keystroke).
    await user.tab();
    await waitFor(() => {
      const errors = screen.getAllByText(/this field is required/i);
      expect(errors.length).toBeGreaterThan(0);
    });

    expect(upsertOidcMock).not.toHaveBeenCalled();
  });

  it('saves a valid OIDC connection via upsertOidc', async () => {
    upsertOidcMock.mockClear();
    const { user } = renderForm(unconfigured);

    // Fill the OIDC-required fields for a NEW (unconfigured) connection.
    await user.clear(screen.getByLabelText(/display name/i));
    await user.type(screen.getByLabelText(/display name/i), 'Acme SSO');
    await user.type(
      screen.getByLabelText(/issuer url/i),
      'https://login.example.com',
    );
    await user.type(screen.getByLabelText(/^client id$/i), 'client-123');
    await user.type(screen.getByLabelText(/^client secret$/i), 'super-secret');

    const saveButton = await screen.findByRole('button', { name: /^save$/i });
    await waitFor(() => expect(saveButton).toBeEnabled());

    await user.click(saveButton);

    await waitFor(() => {
      expect(upsertOidcMock).toHaveBeenCalledTimes(1);
    });
    const args = upsertOidcMock.mock.calls[0][0];
    expect(args).toMatchObject({
      organizationId: 'org-1',
      providerId: 'entra-id',
      issuer: 'https://login.example.com',
      clientId: 'client-123',
      clientSecret: 'super-secret',
    });
    expect(upsertSamlMock).not.toHaveBeenCalled();
  });

  it('round-trips a stored OAuth2 connection’s endpoints into the edit form', async () => {
    // Regression: the read view now carries the explicit OAuth2 endpoints, so
    // the form must seed them — otherwise editing an existing connection blanks
    // its required endpoints and a re-save would wipe them.
    renderForm(oauth2Config);

    expect(await screen.findByLabelText(/authorization endpoint/i)).toHaveValue(
      'https://auth.acme.com/authorize',
    );
    expect(screen.getByLabelText(/token endpoint/i)).toHaveValue(
      'https://auth.acme.com/token',
    );
    expect(screen.getByLabelText(/userinfo endpoint/i)).toHaveValue(
      'https://auth.acme.com/userinfo',
    );
  });

  it('preserves stored SAML SP keypair + options the form cannot edit on re-save', async () => {
    // Regression: the form has no inputs for spCertificate / wantAssertions* /
    // attributeMappings, so an unrelated re-save must NOT drop them (dropping
    // spCertificate would also flip the backend-derived hasSpKeypair off).
    upsertSamlMock.mockClear();
    const { user } = renderForm(samlWithSpKeypair);

    // Edit a field the form DOES expose so the form goes dirty + Save enables.
    const displayName = screen.getByLabelText(/display name/i);
    await user.clear(displayName);
    await user.type(displayName, 'Renamed SSO');

    const saveButton = await screen.findByRole('button', { name: /^save$/i });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    await waitFor(() => expect(upsertSamlMock).toHaveBeenCalledTimes(1));
    expect(upsertSamlMock.mock.calls[0][0]).toMatchObject({
      spCertificate:
        '-----BEGIN CERTIFICATE-----\nSPCERT\n-----END CERTIFICATE-----',
      wantAssertionsSigned: true,
      wantAssertionsEncrypted: false,
      attributeMappings: { email: 'mail' },
    });
  });

  it('does not log uncontrolled→controlled warnings when config resolves after load', async () => {
    // Regression (#2095): the Select/Switch fields must be controlled from the
    // first render. When `config` is undefined the seeded `data` is undefined,
    // so `field.value` is undefined — without a defined fallback the controls
    // mount uncontrolled, then warn once `config` hydrates them.
    // Radix's `useControllableState` reports the transition via `console.warn`
    // (React's native uncontrolled→controlled warning targets DOM inputs; these
    // are button-based Radix controls), so spy on `warn`.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { rerender } = renderForm(undefined);

      // Resolve the config — the form seeds its real values.
      rerender(
        <AbilityContext.Provider value={adminAbility}>
          <ActiveEditorProvider>
            <HeaderSlot />
            <EnterpriseSsoForm organizationId="org-1" config={connectedOidc} />
          </ActiveEditorProvider>
        </AbilityContext.Provider>,
      );

      await screen.findByDisplayValue('Acme SSO');

      const warned = warnSpy.mock.calls.some((call) =>
        call.some(
          (arg) =>
            typeof arg === 'string' && /uncontrolled.*controlled/i.test(arg),
        ),
      );
      expect(warned).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('blocks the test action and does not call testConnection when invalid', async () => {
    testConnMock.mockClear();
    const { user } = renderForm(unconfigured);

    // Issuer + client id are empty → Test must short-circuit.
    const testButton = screen.getByRole('button', { name: /test connection/i });
    await user.click(testButton);

    await waitFor(() => {
      expect(testConnMock).not.toHaveBeenCalled();
    });
    const errors = await screen.findAllByText(/this field is required/i);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('requires a client secret when switching a SAML connection to OIDC (#2057)', async () => {
    upsertOidcMock.mockClear();
    const { user } = renderForm(samlConfig);

    // Switch the protocol SAML → Microsoft Entra ID.
    await user.click(screen.getByRole('combobox', { name: /protocol/i }));
    await user.click(
      await screen.findByRole('option', { name: /microsoft entra id/i }),
    );

    // A SAML-only connection has no stored OIDC secret to reuse, so a blank
    // secret must keep Save blocked even though issuer + client id are filled.
    await user.type(
      screen.getByLabelText(/issuer url/i),
      'https://login.example.com',
    );
    await user.type(screen.getByLabelText(/^client id$/i), 'client-123');

    const saveButton = await screen.findByRole('button', { name: /^save$/i });
    await waitFor(() => expect(saveButton).toBeDisabled());
    expect(upsertOidcMock).not.toHaveBeenCalled();
  });

  it('mounts controls defined so no uncontrolled→controlled warning fires as config loads (#2095)', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <Bare>
        <EnterpriseSsoForm organizationId="org-1" config={undefined} />
      </Bare>,
    );
    rerender(
      <Bare>
        <EnterpriseSsoForm organizationId="org-1" config={connectedOidc} />
      </Bare>,
    );
    const warned = errorSpy.mock.calls.some((call) =>
      /uncontrolled to controlled|controlled to uncontrolled|changing an uncontrolled|changing a controlled/i.test(
        String(call[0]),
      ),
    );
    errorSpy.mockRestore();
    expect(warned).toBe(false);
  });

  it('adds a role-mapping rule and saves it (#2085[12])', async () => {
    upsertOidcMock.mockClear();
    revealClientIdMock.mockResolvedValueOnce('client-xyz');
    const { user } = renderForm(connectedOidc);

    // Wait for the stored client id to be revealed so the OIDC form is valid.
    await waitFor(() =>
      expect(screen.getByLabelText(/^client id$/i)).toHaveValue('client-xyz'),
    );

    // The editor is visible (the connection auto-provisions roles). Add a rule
    // mapping the IdP group "Engineering" to the default member role.
    await user.click(screen.getByRole('button', { name: /add rule/i }));
    await user.type(screen.getByLabelText(/matches value/i), 'Engineering');

    const saveButton = await screen.findByRole('button', { name: /^save$/i });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    await waitFor(() => expect(upsertOidcMock).toHaveBeenCalledTimes(1));
    expect(upsertOidcMock.mock.calls[0][0].roleMappingRules).toEqual([
      { source: 'group', pattern: 'Engineering', targetRole: 'member' },
    ]);
  });
});

describe('EnterpriseSsoForm deployment warnings + redirect URL (A2.1)', () => {
  it('shows the redirect URL up-front for an OIDC connection', () => {
    renderForm(connectedOidc);
    // The dedicated "Redirect URL to register in Entra" field renders the
    // callback URL admins must paste into the IdP (not buried in the guide).
    expect(
      screen.getByText(/redirect url to register in entra/i),
    ).toBeInTheDocument();
    const redirectUrls = screen.getAllByText(
      'https://app.example.com/api/sso/callback',
    );
    expect(redirectUrls.length).toBeGreaterThan(0);
  });

  it('warns when the callback URL is empty (SITE_URL unset)', () => {
    // The unconfigured fixture has oidcCallbackUrl: null → SITE_URL is unset,
    // so the callback URL will be empty (the top cause of a failed sign-in).
    renderForm(unconfigured);
    expect(
      screen.getByText(/deployment not fully configured for sso/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/site_url is not set/i)).toBeInTheDocument();
  });

  it('warns when BETTER_AUTH_SECRET is unset (server-reported)', () => {
    renderForm({
      ...connectedOidc,
      deployment: {
        siteUrlSet: true,
        basePathSet: true,
        authSecretSet: false,
      },
    });
    expect(
      screen.getByText(/deployment not fully configured for sso/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/better_auth_secret is not set/i),
    ).toBeInTheDocument();
  });

  it('shows no deployment warning when the env is healthy', () => {
    renderForm({
      ...connectedOidc,
      deployment: {
        siteUrlSet: true,
        basePathSet: true,
        authSecretSet: true,
      },
    });
    expect(
      screen.queryByText(/deployment not fully configured for sso/i),
    ).not.toBeInTheDocument();
  });
});

describe('EnterpriseSsoForm multi-org email-domain warning', () => {
  it('does not render a domain field or domain warning', () => {
    renderForm({
      ...connectedOidc,
      domain: null,
      otherOrgsEnabled: true,
    });
    expect(screen.queryByLabelText(/email domain/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no email domain set/i)).not.toBeInTheDocument();
  });
});
