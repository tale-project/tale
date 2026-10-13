// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

/**
 * The consent page of a coding agent [AGCONN-R8, AGCONN-R9, AGCONN-R21]: what
 * it offers from what the server says, what it sends when the person
 * connects, and what it asks of a sign-in that is more than a day old.
 */

const h = vi.hoisted(() => ({
  context: vi.fn(),
  $fetch: vi.fn(),
  consent: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  redirectToLogIn: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    getSession: h.getSession,
    $fetch: h.$fetch,
    oauth2: { consent: h.consent },
  },
}));
vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: h.context,
}));
vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ signOut: h.signOut }),
}));
vi.mock('@/app/lib/auth/log-in-redirect', () => ({
  redirectToLogIn: h.redirectToLogIn,
}));
vi.mock('@/app/components/logo/logo-link', () => ({
  LogoLink: () => <a href="/">Tale</a>,
}));

import { BackendApiError } from '@/app/lib/backend/api-client';

import { AgentConsent } from './agent-consent';
import { rememberChoice, rememberedChoice } from './agent-consent-memory';

const HOUR = 60 * 60 * 1000;
const CLIENT_ID = 'https://claude.ai/oauth/claude-code-client-metadata';
const ASKED =
  'tale:mcp tale:automations.write tale:automations.deploy tale:settings.read tale:settings.write tale:subscriptions.connect offline_access';
const SIGNED = `response_type=code&client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent('http://127.0.0.1:54545/callback')}&scope=${encodeURIComponent(ASKED)}&state=s&exp=${Math.floor(Date.now() / 1000) + 600}&sig=bytes%2B`;

const DEVELOPER_CEILING = [
  'tale:mcp',
  'tale:automations.write',
  'tale:automations.deploy',
  'tale:settings.read',
  'tale:settings.write',
  'tale:subscriptions.connect',
];

function organization(
  overrides: Partial<{
    id: string;
    slug: string;
    name: string;
    role: string;
    allowed: boolean;
    reason: 'ORG_FORBIDDEN' | 'AGENT_CONNECT_FORBIDDEN';
    ceiling: string[];
    previous: string[] | null;
  }> = {},
) {
  return {
    id: 'org-acme',
    slug: 'acme',
    name: 'Acme',
    role: 'developer',
    allowed: true,
    ceiling: DEVELOPER_CEILING,
    previous: null,
    ...overrides,
  };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    client: {
      id: CLIENT_ID,
      name: 'Claude Code',
      provenance: 'metadata_document',
      host: 'claude.ai',
    },
    requestedScopes: ASKED.split(' '),
    eligible: true,
    activeOrganizationId: 'org-acme',
    organizations: [organization()],
    ...overrides,
  };
}

function open(search = SIGNED) {
  window.history.pushState({}, '', `/oauth/consent?${search}`);
}

function renderPage(ui: ReactNode = <AgentConsent email="ada@example.test" />) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

const connectButton = () => screen.findByRole('button', { name: 'Connect' });

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  open();
  h.context.mockResolvedValue(context());
  h.getSession.mockResolvedValue({
    data: {
      user: { email: 'ada@example.test' },
      session: { createdAt: new Date(Date.now() - HOUR) },
    },
  });
  h.$fetch.mockResolvedValue({
    data: { redirect: true, url: 'x' },
    error: null,
  });
  h.consent.mockResolvedValue({
    data: { redirect: true, url: 'http://127.0.0.1:54545/callback' },
    error: null,
  });
});
afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('what the page offers [AGCONN-R22]', () => {
  it('names the app, says who vouched for it and where the person goes back to', async () => {
    renderPage();
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Connect Claude Code to Tale',
      }),
    ).toBeVisible();
    expect(screen.getByText('Verified domain: claude.ai')).toBeVisible();
    expect(
      screen.getByText(
        'After you connect, Tale sends you back to this computer (127.0.0.1).',
      ),
    ).toBeVisible();
    expect(screen.getByText('Signed in as ada@example.test')).toBeVisible();
    expect(
      screen.getByRole('img', { name: 'Claude Code connecting to Tale' }),
    ).toBeInTheDocument();
  });

  it('says a web address is where the person goes back to, and not this computer', async () => {
    open(
      SIGNED.replace(
        encodeURIComponent('http://127.0.0.1:54545/callback'),
        encodeURIComponent('https://claude.ai/api/mcp/auth_callback'),
      ),
    );
    renderPage();
    expect(
      await screen.findByText(
        'After you connect, Tale sends you back to claude.ai.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/back to this computer/)).not.toBeInTheDocument();
  });

  it('says nothing of where the person goes back to when the request names no address that can be read', async () => {
    open(SIGNED.replace(/redirect_uri=[^&]*&/, ''));
    renderPage();
    await screen.findByText('Verified domain: claude.ai');
    expect(screen.queryByText(/After you connect/)).not.toBeInTheDocument();
  });

  it('shows a vendor’s own icon for a host Tale verified, and the neutral glyph for any other', async () => {
    const withHost = (host: string | null, provenance: string) =>
      context({
        client: { id: 'x', name: 'Agent', provenance, host },
      });
    h.context.mockResolvedValueOnce(withHost('claude.ai', 'metadata_document'));
    const claude = renderPage();
    await screen.findByText('Verified domain: claude.ai');
    expect(
      claude.container.querySelector('path[fill="#D97757"]'),
    ).not.toBeNull();
    expect(claude.container.querySelector('svg.lucide-bot')).toBeNull();
    claude.unmount();

    h.context.mockResolvedValueOnce(
      withHost('chatgpt.com', 'metadata_document'),
    );
    const chatgpt = renderPage();
    await screen.findByText('Verified domain: chatgpt.com');
    expect(
      chatgpt.container.querySelector('svg[fill="currentColor"] path'),
    ).not.toBeNull();
    expect(chatgpt.container.querySelector('svg.lucide-bot')).toBeNull();
    chatgpt.unmount();

    h.context.mockResolvedValueOnce(
      withHost('agent.example.test', 'metadata_document'),
    );
    const other = renderPage();
    await screen.findByText('Verified domain: agent.example.test');
    expect(other.container.querySelector('svg.lucide-bot')).not.toBeNull();
    expect(other.container.querySelector('path[fill="#D97757"]')).toBeNull();
    other.unmount();

    // A host on an app that registered itself is never believed.
    h.context.mockResolvedValueOnce(withHost('claude.ai', 'registered'));
    const registered = renderPage();
    await screen.findByText('Unverified app');
    expect(registered.container.querySelector('svg.lucide-bot')).not.toBeNull();
    expect(
      registered.container.querySelector('path[fill="#D97757"]'),
    ).toBeNull();
  });

  it('warns about an app that registered itself, and gives it no icon of a vendor', async () => {
    h.context.mockResolvedValue(
      context({
        client: {
          id: 'abc123',
          name: 'Cursor',
          provenance: 'registered',
          host: null,
        },
      }),
    );
    const { container } = renderPage();
    expect(await screen.findByText('Unverified app')).toBeVisible();
    expect(screen.getByRole('note')).toHaveTextContent(
      /registered itself with Tale and chose its own name/,
    );
    expect(screen.queryByText(/Verified domain/)).not.toBeInTheDocument();
    expect(container.querySelector('svg.lucide-bot')).not.toBeNull();
  });

  it('preselects editing for an app that asks for everything, and says what that lets it do', async () => {
    renderPage();
    const edit = await screen.findByRole('radio', {
      name: /Edit automations/,
    });
    expect(edit).toBeChecked();
    const summary = screen.getByRole('list', {
      name: 'What Claude Code can do',
    });
    const lines = within(summary)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(lines).toEqual([
      'Allowed: Read and test',
      'Allowed: Edit automations',
      'Not allowed: Deploy and run live',
      'Not allowed: Read settings',
      'Not allowed: Change settings',
      'Not allowed: Connect subscriptions',
    ]);
    expect(
      screen.getByText(
        'Your role still applies: the agent never does more than you can in Acme.',
      ),
    ).toBeVisible();
    // It is read out as the person chooses.
    expect(summary.closest('[aria-live]')).toHaveAttribute(
      'aria-live',
      'polite',
    );
    expect(
      screen.getByText(/stays connected until you disconnect it/),
    ).toBeVisible();
  });

  it('changes what it says as the person chooses, and reading settings stays on while they can be changed', async () => {
    const { user } = renderPage();
    await user.click(
      await screen.findByRole('radio', { name: /Edit and deploy/ }),
    );
    await user.click(screen.getByRole('checkbox', { name: /Change settings/ }));
    expect(
      screen.getByRole('checkbox', { name: /Read settings/ }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /Read settings/ }),
    ).toBeDisabled();
    const lines = within(
      screen.getByRole('list', { name: 'What Claude Code can do' }),
    )
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(lines).toEqual([
      'Allowed: Read and test',
      'Allowed: Edit automations',
      'Allowed: Deploy and run live',
      'Allowed: Read settings',
      'Allowed: Change settings',
      'Not allowed: Connect subscriptions',
    ]);
    await user.click(screen.getByRole('checkbox', { name: /Change settings/ }));
    expect(
      screen.getByRole('checkbox', { name: /Read settings/ }),
    ).toBeEnabled();
  });

  it('keeps the extras when the level changes', async () => {
    const { user } = renderPage();
    await user.click(
      await screen.findByRole('checkbox', { name: /Connect AI subscriptions/ }),
    );
    await user.click(screen.getByRole('radio', { name: /Edit and deploy/ }));
    expect(
      screen.getByRole('checkbox', { name: /Connect AI subscriptions/ }),
    ).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /Read and test/ }));
    expect(
      screen.getByRole('checkbox', { name: /Connect AI subscriptions/ }),
    ).toBeChecked();
  });

  it('keeps what the role does not allow on the page, unavailable, and says why', async () => {
    h.context.mockResolvedValue(
      context({
        organizations: [
          organization({
            role: 'member',
            ceiling: ['tale:mcp', 'tale:settings.read'],
          }),
        ],
      }),
    );
    renderPage();
    const read = await screen.findByRole('radio', { name: /Read and test/ });
    expect(read).toBeChecked();
    for (const name of [/Edit automations/, /Edit and deploy/]) {
      const radio = screen.getByRole('radio', { name });
      expect(radio).toBeDisabled();
      // The option's own label wraps its description, so what is said
      // there is part of what a screen reader reads for it.
      expect(radio).toHaveAccessibleName(
        /Your role in Acme does not allow this\./,
      );
    }
    expect(
      screen.getByRole('checkbox', { name: /Change settings/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: /Read settings/ }),
    ).toBeEnabled();
    // The summary says it is the role, on each line the role takes away:
    // editing, deploying, changing settings and connecting subscriptions.
    expect(
      within(
        screen.getByRole('list', { name: 'What Claude Code can do' }),
      ).getAllByText('Your role in Acme does not allow this.', {
        selector: 'span.block',
      }),
    ).toHaveLength(4);
  });

  it('takes an app that asks for less at its word', async () => {
    const asked = 'tale:mcp tale:settings.read';
    open(SIGNED.replace(encodeURIComponent(ASKED), encodeURIComponent(asked)));
    h.context.mockResolvedValue(context({ requestedScopes: asked.split(' ') }));
    renderPage();
    expect(
      await screen.findByRole('radio', { name: /Read and test/ }),
    ).toBeChecked();
    expect(
      screen.getByRole('radio', { name: /Edit automations/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole('radio', { name: /Edit automations/ }),
    ).toHaveAccessibleName(/The agent did not ask for this\./);
    expect(
      screen.getByRole('checkbox', { name: /Read settings/ }),
    ).toBeChecked();
  });

  it('offers what the person chose here before', async () => {
    h.context.mockResolvedValue(
      context({
        organizations: [
          organization({
            previous: [
              'tale:mcp',
              'tale:automations.write',
              'tale:automations.deploy',
            ],
          }),
        ],
      }),
    );
    renderPage();
    expect(
      await screen.findByRole('radio', { name: /Edit and deploy/ }),
    ).toBeChecked();
  });
});

describe('the organization [AGCONN-R22]', () => {
  // As the server answers them: those that may connect first, by name.
  const MANY = [
    organization({
      id: 'org-acme',
      slug: 'acme',
      name: 'Acme',
      previous: ['tale:mcp'],
    }),
    organization({
      id: 'org-beta',
      slug: 'beta',
      name: 'Beta',
      previous: null,
    }),
    organization({
      id: 'org-zed',
      slug: 'zed',
      name: 'Zed',
      role: 'member',
      allowed: false,
      reason: 'AGENT_CONNECT_FORBIDDEN',
      ceiling: [],
    }),
    organization({
      id: 'org-off',
      slug: 'off',
      name: 'Off',
      role: 'disabled',
      allowed: false,
      reason: 'ORG_FORBIDDEN',
      ceiling: [],
    }),
  ];

  it('starts on the one the person is working in, and lists the others, those they may not use unavailable and saying why', async () => {
    h.context.mockResolvedValue(
      context({ organizations: MANY, activeOrganizationId: 'org-beta' }),
    );
    renderPage();
    const beta = await screen.findByRole('radio', { name: /Beta · Developer/ });
    expect(beta).toBeChecked();
    expect(
      screen.getByRole('radio', { name: /Acme · Developer/ }),
    ).not.toBeChecked();
    const zed = screen.getByRole('radio', { name: /Zed · Member/ });
    expect(zed).toBeDisabled();
    expect(zed).toHaveAccessibleName(
      /Connecting a coding agent here takes the Owner, Admin or Developer role/,
    );
    expect(screen.getByRole('radio', { name: /Off · / })).toHaveAccessibleName(
      /Your account is disabled in this organization\./,
    );
  });

  it('says nothing of a refusal for an organization the person may use', async () => {
    h.context.mockResolvedValue(
      context({ organizations: MANY, activeOrganizationId: 'org-beta' }),
    );
    renderPage();
    const beta = await screen.findByRole('radio', { name: /Beta · Developer/ });
    expect(beta).toHaveAccessibleName(
      expect.not.stringContaining('Connecting a coding agent here takes'),
    );
    expect(beta).toHaveAccessibleName(
      expect.not.stringContaining('Your account is disabled'),
    );
    expect(
      screen.getByRole('radio', { name: /Acme · Developer/ }),
    ).toBeEnabled();
  });

  it('offers, for the organization chosen, what the person chose there before', async () => {
    h.context.mockResolvedValue(
      context({ organizations: MANY, activeOrganizationId: 'org-beta' }),
    );
    const { user } = renderPage();
    await screen.findByRole('radio', { name: /Beta · Developer/ });
    expect(
      screen.getByRole('radio', { name: /Edit automations/ }),
    ).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /Acme · Developer/ }));
    expect(screen.getByRole('radio', { name: /Read and test/ })).toBeChecked();
    // Back again, what was chosen there is still chosen.
    await user.click(screen.getByRole('radio', { name: /Beta · Developer/ }));
    expect(
      screen.getByRole('radio', { name: /Edit automations/ }),
    ).toBeChecked();
  });

  it('searches a long list of organizations instead of listing them, the unavailable ones saying why', async () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      index === 7
        ? organization({
            id: 'org-7',
            name: 'Org 7',
            role: 'member',
            allowed: false,
            reason: 'AGENT_CONNECT_FORBIDDEN',
            ceiling: [],
          })
        : organization({ id: `org-${index}`, name: `Org ${index}` }),
    );
    h.context.mockResolvedValue(
      context({ organizations: many, activeOrganizationId: 'org-2' }),
    );
    const { user } = renderPage();
    const picker = await screen.findByRole('button', {
      name: 'Organization',
    });
    expect(picker).toHaveTextContent('Org 2 · Developer');
    expect(
      screen.queryByRole('radio', { name: /Org 3/ }),
    ).not.toBeInTheDocument();
    await user.click(picker);
    const unavailable = await screen.findByRole('option', { name: /Org 7/ });
    expect(unavailable).toHaveAttribute('aria-disabled', 'true');
    expect(unavailable).toHaveTextContent(
      /takes the Owner, Admin or Developer role/,
    );
    await user.click(screen.getByRole('option', { name: /Org 5/ }));
    await user.click(await connectButton());
    await waitFor(() => expect(h.$fetch).toHaveBeenCalledTimes(1));
    expect(h.$fetch.mock.calls[0]?.[1]).toMatchObject({
      body: { tale: { organizationId: 'org-5' } },
    });
  });

  it('says why a single organization cannot be used, and offers only Cancel', async () => {
    h.context.mockResolvedValue(
      context({
        organizations: [
          organization({
            role: 'disabled',
            allowed: false,
            reason: 'ORG_FORBIDDEN',
            ceiling: [],
          }),
        ],
        activeOrganizationId: null,
      }),
    );
    renderPage();
    const group = await screen.findByRole('group', { name: 'Organization' });
    expect(group).toHaveTextContent(
      'Your account is disabled in this organization.',
    );
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });

  it('shows a single organization and does not ask about it', async () => {
    renderPage();
    const group = await screen.findByRole('group', { name: 'Organization' });
    expect(group).toHaveTextContent('Acme · Developer');
    expect(within(group).queryByRole('radio')).not.toBeInTheDocument();
  });

  it('says so, and offers only Cancel, when the person may connect an agent nowhere', async () => {
    h.context.mockResolvedValue(
      context({
        organizations: [MANY[2]],
        activeOrganizationId: null,
      }),
    );
    renderPage();
    expect(
      await screen.findByText(
        /None of your organizations lets you connect a coding agent/,
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(
      screen.queryByRole('radio', { name: /Edit automations/ }),
    ).not.toBeInTheDocument();
  });
});

describe('connecting [AGCONN-R22]', () => {
  it('sends the signed request whole, the organization and the access chosen — not the one that stays connected — and leaves the redirect to the auth client', async () => {
    const { user } = renderPage();
    await user.click(await connectButton());
    await waitFor(() => expect(h.$fetch).toHaveBeenCalledTimes(1));
    expect(h.$fetch).toHaveBeenCalledWith('/oauth2/consent', {
      method: 'POST',
      body: {
        accept: true,
        oauth_query: SIGNED,
        scope: 'tale:mcp tale:automations.write',
        tale: { organizationId: 'org-acme' },
      },
    });
    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled();
  });

  it('locks the choices while it connects', async () => {
    h.$fetch.mockReturnValue(new Promise(() => undefined));
    h.context.mockResolvedValue(
      context({
        organizations: [
          organization({ id: 'org-acme', name: 'Acme' }),
          organization({ id: 'org-beta', name: 'Beta' }),
        ],
      }),
    );
    const { user } = renderPage();
    await screen.findByRole('radio', { name: /Beta · Developer/ });
    await user.click(await connectButton());
    expect(
      await screen.findByRole('button', { name: 'Connecting…' }),
    ).toBeDisabled();
    for (const name of [
      /Acme · Developer/,
      /Beta · Developer/,
      /Edit automations/,
    ]) {
      expect(screen.getByRole('radio', { name })).toBeDisabled();
    }
    expect(
      screen.getByRole('checkbox', { name: /Connect AI subscriptions/ }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('names the organization the person chose, not the first', async () => {
    h.context.mockResolvedValue(
      context({
        organizations: [
          organization({ id: 'org-acme', name: 'Acme' }),
          organization({ id: 'org-beta', name: 'Beta' }),
        ],
        activeOrganizationId: 'org-acme',
      }),
    );
    const { user } = renderPage();
    await user.click(
      await screen.findByRole('radio', { name: /Beta · Developer/ }),
    );
    await user.click(await connectButton());
    await waitFor(() => expect(h.$fetch).toHaveBeenCalledTimes(1));
    expect(h.$fetch.mock.calls[0]?.[1]).toMatchObject({
      body: { tale: { organizationId: 'org-beta' } },
    });
  });

  it('sends what was chosen: a level, an extra, and reading settings along with changing them', async () => {
    const { user } = renderPage();
    await user.click(
      await screen.findByRole('radio', { name: /Read and test/ }),
    );
    await user.click(screen.getByRole('checkbox', { name: /Change settings/ }));
    await user.click(await connectButton());
    await waitFor(() => expect(h.$fetch).toHaveBeenCalledTimes(1));
    expect(h.$fetch.mock.calls[0]?.[1]).toMatchObject({
      body: {
        scope: 'tale:mcp tale:settings.read tale:settings.write',
      },
    });
  });

  it('answers a refusal in the server’s words for it, and lets the person try again', async () => {
    h.$fetch.mockResolvedValueOnce({
      data: null,
      error: { status: 403, code: 'AGENT_SCOPE_NOT_ALLOWED' },
    });
    const { user } = renderPage();
    await user.click(await connectButton());
    expect(
      await screen.findByText(
        'Your role does not allow the access you chose. Choose less access.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
  });

  it.each([
    ['AGENT_CONSENT_ORG_REQUIRED', 'Choose an organization.'],
    ['ORG_FORBIDDEN', 'You are no longer a member of this organization.'],
    ['IDENTITY_NOT_ELIGIBLE', /Your account cannot connect agents yet/],
    ['AGENT_CONNECTION_UNAVAILABLE', /could not be made right now/],
    ['SOMETHING_ELSE', /could not be completed/],
  ])('words a refusal with %s', async (code, words) => {
    h.$fetch.mockResolvedValueOnce({
      data: null,
      error: { status: 400, code },
    });
    const { user } = renderPage();
    await user.click(await connectButton());
    expect(await screen.findByText(words)).toBeVisible();
  });

  it('says it could not be completed when the answer holds no redirect to follow', async () => {
    h.$fetch.mockResolvedValueOnce({ data: {}, error: null });
    const { user } = renderPage();
    await user.click(await connectButton());
    expect(await screen.findByText(/could not be completed/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
  });

  it('says it could not be completed when the request itself fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.$fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { user } = renderPage();
    await user.click(await connectButton());
    expect(await screen.findByText(/could not be completed/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
  });

  it('declines through the auth client with the signed request whole', async () => {
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(h.consent).toHaveBeenCalledExactlyOnceWith({
      accept: false,
      oauth_query: SIGNED,
    });
    expect(h.$fetch).not.toHaveBeenCalled();
  });

  it('says it could not be completed when declining fails, or answers with no redirect to follow', async () => {
    h.consent.mockResolvedValueOnce({ data: null, error: { status: 400 } });
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/could not be completed/)).toBeVisible();
    h.consent.mockResolvedValueOnce({ data: {}, error: null });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(h.consent).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });
});

describe('a sign-in more than a day old [AGCONN-R9]', () => {
  const stale = () =>
    h.getSession.mockResolvedValue({
      data: {
        user: { email: 'ada@example.test' },
        session: { createdAt: new Date(Date.now() - 25 * HOUR) },
      },
    });

  it('asks for the password before more than reading and reading settings, and only then', async () => {
    stale();
    const { user } = renderPage();
    const connect = await connectButton();
    // Editing is chosen: the page asks.
    expect(
      await screen.findByRole('group', { name: 'Confirm it’s you' }),
    ).toBeVisible();
    expect(connect).toBeDisabled();
    expect(connect).toHaveAccessibleDescription('Confirm it’s you');
    // Reading and reading settings need no confirmation.
    await user.click(screen.getByRole('radio', { name: /Read and test/ }));
    expect(
      screen.queryByRole('group', { name: 'Confirm it’s you' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
    await user.click(screen.getByRole('radio', { name: /Edit automations/ }));
    expect(
      screen.getByRole('group', { name: 'Confirm it’s you' }),
    ).toBeVisible();
  });

  it('asks nothing before it knows how old the sign-in is, and lets the server decide', async () => {
    h.getSession.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled(),
    );
    expect(
      screen.queryByRole('group', { name: 'Confirm it’s you' }),
    ).not.toBeInTheDocument();
  });

  it('opens the way to connecting once the password is confirmed', async () => {
    stale();
    h.$fetch.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/reauthenticate'
          ? { data: { status: true }, error: null }
          : { data: { redirect: true, url: 'x' }, error: null },
      ),
    );
    const { user } = renderPage();
    await screen.findByRole('group', { name: 'Confirm it’s you' });
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Confirm it’s you' }),
      ).not.toBeInTheDocument(),
    );
    expect(h.$fetch).toHaveBeenCalledWith('/reauthenticate', {
      method: 'POST',
      body: { password: 'correct horse' },
    });
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
  });

  it('keeps asking, with the reason, when the password is wrong', async () => {
    stale();
    h.$fetch.mockResolvedValueOnce({
      data: null,
      error: { status: 401, code: 'INVALID_PASSWORD' },
    });
    const { user } = renderPage();
    await screen.findByRole('group', { name: 'Confirm it’s you' });
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/Wrong password/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });

  it('sends an account without a password to sign in again', async () => {
    stale();
    h.$fetch.mockResolvedValueOnce({
      data: null,
      error: { status: 400, code: 'PASSWORD_NOT_SET' },
    });
    h.signOut.mockResolvedValue(undefined);
    const { user } = renderPage();
    await screen.findByRole('group', { name: 'Confirm it’s you' });
    await user.type(screen.getByLabelText('Password'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(
      await screen.findByText(/signs in through your company’s sign-in/),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    await waitFor(() => expect(h.redirectToLogIn).toHaveBeenCalledTimes(1));
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });

  it('asks again when the server finds the sign-in too old after all', async () => {
    h.$fetch.mockResolvedValueOnce({
      data: null,
      error: { status: 403, code: 'SESSION_NOT_FRESH' },
    });
    const { user } = renderPage();
    await user.click(await connectButton());
    expect(
      await screen.findByText('Confirm your password first.'),
    ).toBeVisible();
    expect(
      screen.getByRole('group', { name: 'Confirm it’s you' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });
});

describe('what the person chose, across confirming their password [AGCONN-R22]', () => {
  const stale = () =>
    h.getSession.mockResolvedValue({
      data: {
        user: { email: 'ada@example.test' },
        session: { createdAt: new Date(Date.now() - 25 * HOUR) },
      },
    });
  const WITH_CHALLENGE = `${SIGNED}&code_challenge=challenge-1`;

  it('is kept when they confirm, because the provider signs the request anew for the new session, and found again by the page that follows', async () => {
    stale();
    open(WITH_CHALLENGE);
    h.context.mockResolvedValue(
      context({
        organizations: [
          organization({ id: 'org-beta', name: 'Beta' }),
          organization({ id: 'org-acme', name: 'Acme' }),
        ],
        activeOrganizationId: 'org-acme',
      }),
    );
    const first = renderPage();
    await first.user.click(
      await screen.findByRole('radio', { name: /Edit and deploy/ }),
    );
    await first.user.click(
      screen.getByRole('checkbox', { name: /Change settings/ }),
    );
    await first.user.click(
      screen.getByRole('radio', { name: /Beta · Developer/ }),
    );
    await first.user.click(
      screen.getByRole('radio', { name: /Edit and deploy/ }),
    );
    await first.user.type(screen.getByLabelText('Password'), 'correct horse');
    await first.user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(rememberedChoice({ codeChallenge: 'challenge-1' })).toMatchObject({
      organizationId: 'org-beta',
      choice: { level: 'deploy' },
    });
    first.unmount();

    // The page the provider sends them back to: the same request, signed anew.
    h.getSession.mockResolvedValue({
      data: {
        user: { email: 'ada@example.test' },
        session: { createdAt: new Date() },
      },
    });
    open(WITH_CHALLENGE.replace('sig=bytes%2B', 'sig=anew%2B'));
    renderPage();
    expect(
      await screen.findByRole('radio', { name: /Beta · Developer/ }),
    ).toBeChecked();
    expect(
      screen.getByRole('radio', { name: /Edit and deploy/ }),
    ).toBeChecked();
    // What was kept is spent: the next opening starts from the page's own.
    await waitFor(() =>
      expect(rememberedChoice({ codeChallenge: 'challenge-1' })).toBeNull(),
    );
  });

  it('is kept when they confirm with the Enter key too', async () => {
    stale();
    open(WITH_CHALLENGE);
    const { user } = renderPage();
    await user.click(
      await screen.findByRole('radio', { name: /Edit and deploy/ }),
    );
    await user.type(screen.getByLabelText('Password'), 'correct horse{Enter}');
    expect(
      rememberedChoice({ codeChallenge: 'challenge-1' })?.choice.level,
    ).toBe('deploy');
    expect(h.$fetch).toHaveBeenCalledWith('/reauthenticate', {
      method: 'POST',
      body: { password: 'correct horse' },
    });
  });

  it('is kept when they sign in again too', async () => {
    stale();
    open(WITH_CHALLENGE);
    h.$fetch.mockResolvedValueOnce({
      data: null,
      error: { status: 400, code: 'PASSWORD_NOT_SET' },
    });
    h.signOut.mockResolvedValue(undefined);
    const { user } = renderPage();
    await user.click(
      await screen.findByRole('radio', { name: /Edit and deploy/ }),
    );
    await user.type(screen.getByLabelText('Password'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    const signIn = await screen.findByRole('button', { name: 'Sign in again' });
    // What the failed confirmation kept is not what is under test.
    window.sessionStorage.clear();
    await user.click(signIn);
    expect(
      rememberedChoice({ codeChallenge: 'challenge-1' })?.choice.level,
    ).toBe('deploy');
  });

  it('is not trusted for an organization the person no longer belongs to', async () => {
    open(WITH_CHALLENGE);
    rememberChoice(
      { codeChallenge: 'challenge-1' },
      {
        organizationId: 'org-gone',
        choice: { level: 'deploy', extras: new Set() },
      },
    );
    renderPage();
    expect(
      await screen.findByRole('radio', { name: /Edit automations/ }),
    ).toBeChecked();
    expect(
      screen.getByRole('group', { name: 'Organization' }),
    ).toHaveTextContent('Acme');
  });

  it('does not hold the page to a choice its offer no longer allows', async () => {
    open(WITH_CHALLENGE);
    rememberChoice(
      { codeChallenge: 'challenge-1' },
      {
        organizationId: 'org-acme',
        choice: { level: 'deploy', extras: new Set(['tale:settings.write']) },
      },
    );
    h.context.mockResolvedValue(
      context({
        organizations: [
          organization({
            role: 'member',
            ceiling: ['tale:mcp', 'tale:settings.read'],
          }),
        ],
      }),
    );
    renderPage();
    expect(
      await screen.findByRole('radio', { name: /Read and test/ }),
    ).toBeChecked();
  });

  it('starts from the page’s own choices when nothing was kept', async () => {
    open(WITH_CHALLENGE);
    renderPage();
    expect(
      await screen.findByRole('radio', { name: /Edit automations/ }),
    ).toBeChecked();
  });
});

describe('what stands in the way', () => {
  it('says an account that cannot sign in to an organization yet cannot connect agents', async () => {
    h.context.mockResolvedValue(context({ eligible: false }));
    renderPage();
    expect(
      await screen.findByText(/Your account cannot connect agents yet/),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('says a request that has run out is over, and offers no way on, asking the server nothing', async () => {
    open(SIGNED.replace(/exp=\d+/, `exp=${Math.floor(Date.now() / 1000) - 5}`));
    renderPage();
    expect(
      await screen.findByText(
        'This request has expired. Start the connection again from your coding agent.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(h.context).not.toHaveBeenCalled();
  });

  it('says a sign-in that belongs to one organization cannot connect an agent', async () => {
    h.context.mockRejectedValue(
      new BackendApiError(403, 'one organization only', 'ORG_FORBIDDEN'),
    );
    renderPage();
    expect(
      await screen.findByText(/This sign-in belongs to one organization/),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });

  it('says an app Tale could not read cannot be connected, whatever else refused it', async () => {
    h.context.mockRejectedValue(
      new BackendApiError(403, 'forbidden', 'SOMETHING_ELSE'),
    );
    renderPage();
    expect(
      await screen.findByText(/Tale could not read this app’s details/),
    ).toBeVisible();
    expect(
      screen.queryByText(/belongs to one organization/),
    ).not.toBeInTheDocument();
  });

  it('says an app Tale could not read cannot be connected', async () => {
    h.context.mockRejectedValue(
      new BackendApiError(404, 'unknown', 'CLIENT_NOT_FOUND'),
    );
    renderPage();
    expect(
      await screen.findByText(/Tale could not read this app’s details/),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });

  it('stops saying it is loading once it has the answer', async () => {
    renderPage();
    await screen.findByRole('radio', { name: /Edit automations/ });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('waits for the server before offering anything', async () => {
    h.context.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(await screen.findByRole('status')).toHaveTextContent('Loading…');
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });
});

describe('accessibility', () => {
  it('passes an audit with everything on the page', async () => {
    h.context.mockResolvedValue(
      context({
        organizations: [
          organization(),
          organization({
            id: 'org-zed',
            name: 'Zed',
            role: 'member',
            allowed: false,
            reason: 'AGENT_CONNECT_FORBIDDEN',
            ceiling: [],
          }),
        ],
      }),
    );
    h.getSession.mockResolvedValue({
      data: {
        user: { email: 'ada@example.test' },
        session: { createdAt: new Date(Date.now() - 25 * HOUR) },
      },
    });
    const { container } = renderPage();
    await screen.findByRole('group', { name: 'Confirm it’s you' });
    await checkAccessibility(container);
  });
});
