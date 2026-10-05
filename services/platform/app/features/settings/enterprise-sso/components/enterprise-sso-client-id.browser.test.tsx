import '@testing-library/jest-dom/vitest';
import {
  ActiveEditorProvider,
  EditorActions,
  useActiveEditor,
} from '@tale/ui/editor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import type { SsoConnectionView } from '@/lib/shared/schemas/enterprise_sso';
import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { EnterpriseSsoForm } from './enterprise-sso-form';

const ORG = 'org-synthetic';
const ADMIN = defineAbilityFor('admin');
const config: SsoConnectionView = {
  configured: true,
  enabled: true,
  protocol: 'oidc',
  displayName: 'Acme SSO',
  domain: 'acme.com',
  oidc: {
    providerId: 'generic-oidc',
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

function HeaderActions() {
  const editor = useActiveEditor();
  return editor ? <EditorActions controller={editor} /> : null;
}
let client: QueryClient;
beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

/** Real form, hooks and HTTP adapters; only HTTP is simulated. Captured
 * writes prove the outgoing draft, not persistence or provider sign-in. */
function setup() {
  let finishReveal: (response: Response) => void = () => {
    throw new Error('Reveal has not started');
  };
  const pending = new Promise<Response>((resolve) => {
    finishReveal = resolve;
  });
  const writes: unknown[] = [];
  const reads: string[] = [];
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin,
    );
    expect(url.origin).toBe(window.location.origin);
    if (url.pathname === '/api/app/users/me')
      return Promise.resolve(Response.json({ user: null }));
    expect(url.searchParams.get('orgId')).toBe(ORG);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.pathname === '/api/app/sso/config/client-id') {
      reads.push(url.pathname);
      return pending;
    }
    if (method === 'PUT' && url.pathname === '/api/app/sso/config/oidc') {
      if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
      const body: unknown = JSON.parse(init.body);
      writes.push(body);
      return Promise.resolve(Response.json({ ok: true }));
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  });
  const view = render(
    <QueryClientProvider client={client}>
      <AbilityContext.Provider value={ADMIN}>
        <ActiveEditorProvider>
          <HeaderActions />
          <EnterpriseSsoForm organizationId={ORG} config={config} />
        </ActiveEditorProvider>
      </AbilityContext.Provider>
    </QueryClientProvider>,
  );
  return { ...view, finishReveal, writes, reads };
}
const clientIdInput = () =>
  screen.getByRole('textbox', { name: /^client id$/i });
async function saveReplacement(view: ReturnType<typeof setup>) {
  const name = screen.getByRole('textbox', { name: /display name/i });
  await view.user.clear(name);
  await view.user.type(name, 'Replacement SSO');
  const save = screen.getByRole('button', { name: /^save$/i });
  await waitFor(() => expect(save).toBeEnabled());
  await view.user.click(save);
  await waitFor(() => expect(view.writes).toHaveLength(1));
  expect(view.writes[0]).toMatchObject({
    clientId: 'replacement-client-id',
    displayName: 'Replacement SSO',
  });
}

describe('Enterprise SSO initial client-ID loading (#3925)', () => {
  it('preserves and submits an edit made before the stored ID arrives', async () => {
    const view = setup();
    await waitFor(() => expect(view.reads).toHaveLength(1));
    expect(clientIdInput()).toBeEnabled();
    await view.user.type(clientIdInput(), 'replacement-client-id');
    view.finishReveal(Response.json({ clientId: 'stored-client-id' }));
    await saveReplacement(view);
    expect(clientIdInput()).toHaveValue('replacement-client-id');
  });
  it('fills an untouched field without dirtying the form', async () => {
    const view = setup();
    await waitFor(() => expect(view.reads).toHaveLength(1));
    view.finishReveal(Response.json({ clientId: 'stored-client-id' }));
    await waitFor(() =>
      expect(clientIdInput()).toHaveValue('stored-client-id'),
    );
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    await view.user.type(
      screen.getByRole('textbox', { name: /display name/i }),
      ' changed',
    );
    await view.user.tab();
    const save = screen.getByRole('button', { name: /^save$/i });
    await waitFor(() => expect(save).toBeEnabled());
    await view.user.click(save);
    await waitFor(() => expect(view.writes).toHaveLength(1));
    expect(view.writes[0]).toMatchObject({ clientId: 'stored-client-id' });
  });
  it('fills the untouched client ID while a display-name edit is pending', async () => {
    const view = setup();
    await waitFor(() => expect(view.reads).toHaveLength(1));
    await view.user.type(
      screen.getByRole('textbox', { name: /display name/i }),
      ' changed',
    );
    view.finishReveal(Response.json({ clientId: 'stored-client-id' }));
    await waitFor(() =>
      expect(clientIdInput()).toHaveValue('stored-client-id'),
    );
    await view.user.tab();
    const save = screen.getByRole('button', { name: /^save$/i });
    await waitFor(() => expect(save).toBeEnabled());
    await view.user.click(save);
    await waitFor(() => expect(view.writes).toHaveLength(1));
    expect(view.writes[0]).toMatchObject({
      clientId: 'stored-client-id',
      displayName: 'Acme SSO changed',
    });
  });

  it('retains and submits the replacement when revealing is refused', async () => {
    const view = setup();
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    await waitFor(() => expect(view.reads).toHaveLength(1));
    await view.user.type(clientIdInput(), 'replacement-client-id');
    view.finishReveal(Response.json({ error: 'FORBIDDEN' }, { status: 403 }));
    await waitFor(() => expect(warning).toHaveBeenCalled());
    expect(clientIdInput()).toHaveValue('replacement-client-id');
    await saveReplacement(view);
  });
  it('submits an edit made after revealing the stored ID', async () => {
    const view = setup();
    await waitFor(() => expect(view.reads).toHaveLength(1));
    view.finishReveal(Response.json({ clientId: 'stored-client-id' }));
    await waitFor(() =>
      expect(clientIdInput()).toHaveValue('stored-client-id'),
    );
    await view.user.clear(clientIdInput());
    await view.user.type(clientIdInput(), 'replacement-client-id');
    await saveReplacement(view);
  });
});
