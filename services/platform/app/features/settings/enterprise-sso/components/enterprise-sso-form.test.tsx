import { screen, waitFor } from '@testing-library/react';
import { ConvexError } from 'convex/values';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

// Capture the action mocks so individual tests can assert on them. Each hook
// returns the SAME stable mutation object so the test can read `.mutateAsync`.
// Declared via `vi.hoisted` so they exist when the hoisted `vi.mock` factory
// below runs.
const {
  upsertOidcMock,
  upsertSamlMock,
  testConnMock,
  revealClientIdMock,
  parseMetadataMock,
  toastMock,
} = vi.hoisted(() => ({
  upsertOidcMock: vi.fn().mockResolvedValue(null),
  upsertSamlMock: vi.fn().mockResolvedValue(null),
  testConnMock: vi.fn().mockResolvedValue({ valid: true }),
  revealClientIdMock: vi.fn().mockResolvedValue(null),
  parseMetadataMock: vi.fn().mockResolvedValue(null),
  toastMock: vi.fn(),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
  toast: toastMock,
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
    useParseSamlMetadata: stub(parseMetadataMock),
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
    const displayName = screen.getByRole('textbox', { name: /display name/i });
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
    await user.clear(screen.getByRole('textbox', { name: /display name/i }));
    await user.type(
      screen.getByRole('textbox', { name: /display name/i }),
      'Acme SSO',
    );
    await user.type(
      screen.getByRole('textbox', { name: /issuer url/i }),
      'https://login.example.com',
    );
    await user.type(
      screen.getByRole('textbox', { name: /^client id$/i }),
      'client-123',
    );
    await user.type(
      screen.getByLabelText(/^client secret$/i, { selector: 'input' }),
      'super-secret',
    );

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

  it('reports a successful save through the cluster only — no page toast', async () => {
    // Save feedback belongs to the `EditorActions` cluster: it flashes "Saved"
    // on its own, so a page toast here would report one save twice.
    upsertSamlMock.mockClear();
    toastMock.mockClear();
    const { user } = renderForm(samlConfig);

    const displayName = screen.getByRole('textbox', { name: /display name/i });
    await user.clear(displayName);
    await user.type(displayName, 'Renamed SSO');

    const saveButton = await screen.findByRole('button', { name: /^save$/i });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    await waitFor(() => expect(upsertSamlMock).toHaveBeenCalledTimes(1));
    expect(toastMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/^saved$/i)).toBeInTheDocument();
  });

  it('pins a rejected client secret under its own input instead of toasting', async () => {
    // A field-mappable server error routes through `mapServerError`, so it
    // renders under the client-secret input and raises no toast at all.
    upsertOidcMock.mockClear();
    toastMock.mockClear();
    upsertOidcMock.mockRejectedValueOnce(
      new ConvexError({ code: 'sso_client_secret_required' }),
    );
    // The read view omits the client id; the form reveals it on mount and the
    // schema requires it, so seed the reveal or Save never enables.
    revealClientIdMock.mockResolvedValueOnce('client-123');
    const { user } = renderForm(connectedOidc);

    const displayName = screen.getByRole('textbox', { name: /display name/i });
    await user.clear(displayName);
    await user.type(displayName, 'Renamed SSO');

    const saveButton = await screen.findByRole('button', { name: /^save$/i });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    expect(
      await screen.findByText(/a client secret is required/i),
    ).toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('surfaces any other save failure as the cluster’s one destructive toast', async () => {
    upsertOidcMock.mockClear();
    toastMock.mockClear();
    upsertOidcMock.mockRejectedValueOnce(new Error('boom'));
    revealClientIdMock.mockResolvedValueOnce('client-123');
    const { user } = renderForm(connectedOidc);

    const displayName = screen.getByRole('textbox', { name: /display name/i });
    await user.clear(displayName);
    await user.type(displayName, 'Renamed SSO');

    const saveButton = await screen.findByRole('button', { name: /^save$/i });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(toastMock).toHaveBeenCalledWith({
      title: 'Save',
      description: 'Failed to save',
      variant: 'destructive',
    });
  });

  it('round-trips a stored OAuth2 connection’s endpoints into the edit form', async () => {
    // Regression: the read view now carries the explicit OAuth2 endpoints, so
    // the form must seed them — otherwise editing an existing connection blanks
    // its required endpoints and a re-save would wipe them.
    renderForm(oauth2Config);

    expect(
      await screen.findByRole('textbox', { name: /authorization endpoint/i }),
    ).toHaveValue('https://auth.acme.com/authorize');
    expect(
      screen.getByRole('textbox', { name: /token endpoint/i }),
    ).toHaveValue('https://auth.acme.com/token');
    expect(
      screen.getByRole('textbox', { name: /userinfo endpoint/i }),
    ).toHaveValue('https://auth.acme.com/userinfo');
  });

  it('preserves stored SAML SP keypair + options the form cannot edit on re-save', async () => {
    // Regression: the form has no inputs for spCertificate / wantAssertions* /
    // attributeMappings, so an unrelated re-save must NOT drop them (dropping
    // spCertificate would also flip the backend-derived hasSpKeypair off).
    upsertSamlMock.mockClear();
    const { user } = renderForm(samlWithSpKeypair);

    // Edit a field the form DOES expose so the form goes dirty + Save enables.
    const displayName = screen.getByRole('textbox', { name: /display name/i });
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
      screen.getByRole('textbox', { name: /issuer url/i }),
      'https://login.example.com',
    );
    await user.type(
      screen.getByRole('textbox', { name: /^client id$/i }),
      'client-123',
    );

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

  it('drives the provisioning payload from the shared toggle rows (#2383)', async () => {
    upsertOidcMock.mockClear();
    revealClientIdMock.mockResolvedValueOnce('client-xyz');
    const { user } = renderForm(connectedOidc);

    // Wait for the stored client id to be revealed so the OIDC form is valid.
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /^client id$/i })).toHaveValue(
        'client-xyz',
      ),
    );

    // The toggles are `SettingsToggleRow`s now — the switch's accessible name
    // is the row label. Flip team sync off (the fixture stores it on).
    const teamSync = screen.getByRole('switch', {
      name: /sync idp groups to teams/i,
    });
    expect(teamSync).toBeChecked();
    await user.click(teamSync);

    const saveButton = await screen.findByRole('button', { name: /^save$/i });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    // Same payload shape as before the primitives rebuild.
    await waitFor(() => expect(upsertOidcMock).toHaveBeenCalledTimes(1));
    expect(upsertOidcMock.mock.calls[0][0]).toMatchObject({
      organizationId: 'org-1',
      autoProvisionRole: true,
      defaultRole: 'member',
      autoProvisionTeam: false,
    });
  });

  it('renders the setup guide as a collapsible, closed by default (#2383)', () => {
    renderForm(connectedOidc);
    // The form carries several <details> now (Advanced, setup guide) — anchor
    // on the guide's own summary text.
    const details = screen.getByText(/setup guide/i).closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
  });

  it('adds a role-mapping rule and saves it (#2085[12])', async () => {
    upsertOidcMock.mockClear();
    revealClientIdMock.mockResolvedValueOnce('client-xyz');
    const { user } = renderForm(connectedOidc);

    // Wait for the stored client id to be revealed so the OIDC form is valid.
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /^client id$/i })).toHaveValue(
        'client-xyz',
      ),
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

describe('EnterpriseSsoForm IdP metadata import (#2652)', () => {
  beforeEach(() => {
    parseMetadataMock.mockReset();
    toastMock.mockClear();
  });

  it('imports metadata from a URL and fills the three SAML fields, still editable', async () => {
    parseMetadataMock.mockResolvedValueOnce({
      idpEntityId: 'https://sts.example.net/entity',
      idpSsoUrl: 'https://sts.example.net/saml2',
      idpCertificate:
        '-----BEGIN CERTIFICATE-----\nIMPORTED\n-----END CERTIFICATE-----',
    });
    const { user } = renderForm(samlConfig);

    await user.type(
      screen.getByLabelText(/^metadata url$/i),
      'https://idp.example.com/federationmetadata.xml',
    );
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() =>
      expect(parseMetadataMock).toHaveBeenCalledWith({
        organizationId: 'org-1',
        url: 'https://idp.example.com/federationmetadata.xml',
      }),
    );
    const entityId = screen.getByRole('textbox', { name: /idp entity id/i });
    await waitFor(() =>
      expect(entityId).toHaveValue('https://sts.example.net/entity'),
    );
    expect(
      screen.getByRole('textbox', { name: /idp sign-on url/i }),
    ).toHaveValue('https://sts.example.net/saml2');
    expect(
      screen.getByRole('textbox', { name: /idp signing certificate/i }),
    ).toHaveValue(
      '-----BEGIN CERTIFICATE-----\nIMPORTED\n-----END CERTIFICATE-----',
    );
    // Importing is the draft; the fields stay editable as the review step.
    expect(entityId).not.toHaveAttribute('readonly');
    await user.type(entityId, '2');
    expect(entityId).toHaveValue('https://sts.example.net/entity2');
  });

  it('parses an uploaded XML file through the server action', async () => {
    parseMetadataMock.mockResolvedValueOnce({
      idpEntityId: 'https://sts.example.net/entity',
      idpSsoUrl: 'https://sts.example.net/saml2',
      idpCertificate:
        '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----',
    });
    const { user, container } = renderForm(samlConfig);

    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    const file = new File(['<EntityDescriptor/>'], 'metadata.xml', {
      type: 'text/xml',
    });
    if (fileInput) await user.upload(fileInput, file);

    await waitFor(() =>
      expect(parseMetadataMock).toHaveBeenCalledWith({
        organizationId: 'org-1',
        xml: '<EntityDescriptor/>',
      }),
    );
  });

  it('rejects an oversized upload client-side without calling the action', async () => {
    const { user, container } = renderForm(samlConfig);

    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    // 1 MiB + 1 byte — just over the server's MAX_SAML_METADATA_BYTES mirror.
    const oversized = new File([new Uint8Array(1_048_577)], 'metadata.xml', {
      type: 'text/xml',
    });
    if (fileInput) await user.upload(fileInput, oversized);

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: expect.stringMatching(/too large/i),
        variant: 'destructive',
      }),
    );
    expect(parseMetadataMock).not.toHaveBeenCalled();
  });

  it('maps a stable server error code to its localized message', async () => {
    parseMetadataMock.mockRejectedValueOnce(
      new ConvexError({ code: 'sso_metadata_not_idp' }),
    );
    const { user } = renderForm(samlConfig);

    await user.type(
      screen.getByLabelText(/^metadata url$/i),
      'https://idp.example.com/meta.xml',
    );
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: expect.stringMatching(/describes no identity provider/i),
        variant: 'destructive',
      }),
    );
    // The stored values stay untouched on failure.
    expect(screen.getByRole('textbox', { name: /idp entity id/i })).toHaveValue(
      'https://idp.example.com/entity',
    );
  });
});

describe('EnterpriseSsoForm per-protocol display name (#2652)', () => {
  it('follows the protocol switch while the name is still a default', async () => {
    const { user } = renderForm(unconfigured);

    // Unconfigured seeds the Entra default.
    const displayName = screen.getByRole('textbox', { name: /display name/i });
    expect(displayName).toHaveValue('Microsoft Entra ID');

    await user.click(screen.getByRole('combobox', { name: /protocol/i }));
    await user.click(await screen.findByRole('option', { name: /saml 2\.0/i }));
    expect(displayName).toHaveValue('SAML SSO');
  });

  it('never overwrites a customized name on protocol switch', async () => {
    const { user } = renderForm(unconfigured);

    const displayName = screen.getByRole('textbox', { name: /display name/i });
    await user.clear(displayName);
    await user.type(displayName, 'Acme corporate login');

    await user.click(screen.getByRole('combobox', { name: /protocol/i }));
    await user.click(await screen.findByRole('option', { name: /saml 2\.0/i }));
    expect(displayName).toHaveValue('Acme corporate login');
  });

  it('keeps a stored custom name over the protocol default', () => {
    renderForm(samlConfig); // displayName: 'Acme SSO'
    expect(screen.getByRole('textbox', { name: /display name/i })).toHaveValue(
      'Acme SSO',
    );
  });
});

describe('EnterpriseSsoForm PKCE under Advanced (#2653)', () => {
  it('renders the PKCE toggle inside a closed Advanced disclosure, default unchanged', () => {
    renderForm(unconfigured);

    const pkce = screen.getByRole('switch', { name: /use pkce/i });
    const details = pkce.closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent(/advanced/i);
    // Default stays on — moving the control must not change behaviour.
    expect(pkce).toHaveAttribute('aria-checked', 'true');
  });
});
