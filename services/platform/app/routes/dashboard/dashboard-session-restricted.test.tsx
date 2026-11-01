import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionLapseRecovery } from '@/app/components/session-lapse-recovery';
import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import { SESSION_ORGANIZATION_MESSAGE } from '@/lib/shared/constants/session-authority';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
  type ShippedLocale,
} from '@/tests/utils/lapsed-session';
import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from '@/tests/utils/render';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { Route } from './$id';

// The whole shell renders before the member read settles; on a loaded
// runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

/** What the page reads besides the backend: the session Better Auth holds,
 * and what ending it, a toast and the router were asked to do. */
const h = vi.hoisted(() => ({
  session: undefined as unknown,
  signOut: vi.fn(),
  toast: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useParams: () => ({ id: 'org-b' }),
  }),
  Outlet: () => <h2>Page</h2>,
  useLocation: () => ({ pathname: '/dashboard/org-b', search: {} }),
  useNavigate: () => h.navigate,
  useBlocker: () => ({
    status: 'idle',
    proceed: () => undefined,
    reset: () => undefined,
  }),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    getSession: () => Promise.resolve(h.session),
    signOut: (...args: unknown[]) => h.signOut(...args),
    organization: { setActive: () => Promise.resolve() },
  },
}));
vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: h.toast,
}));
vi.mock('@/app/lib/backend/use-backend-hints', () => ({
  useBackendHints: () => undefined,
}));
vi.mock('@/app/features/auth/hooks/use-password-expiry-gate', () => ({
  usePasswordExpiryGate: () => undefined,
}));
vi.mock('@/app/components/user-button', () => ({
  UserButton: () => <button type="button">Account</button>,
}));

/** What each shipped locale shows a member whose session is bound to
 * another organization, and the sentence it must not show them. */
const RESTRICTED: Record<
  ShippedLocale,
  { message: string; action: string; noMembership: string }
> = {
  en: {
    message: 'This session is limited to the organization that signed you in.',
    action: 'Sign in to this workspace',
    noMembership:
      "You're not a member of this workspace. Contact an administrator for access.",
  },
  de: {
    message:
      'Diese Sitzung ist auf die Organisation beschränkt, die dich angemeldet hat.',
    action: 'Bei diesem Arbeitsbereich anmelden',
    noMembership:
      'Du bist kein Mitglied dieses Arbeitsbereichs. Wende dich an einen Administrator.',
  },
  fr: {
    message: 'Cette session est limitée à l’organisation qui t’a connecté.',
    action: 'Se connecter à cet espace de travail',
    noMembership:
      "Tu n'es pas membre de cet espace de travail. Contacte un administrateur pour obtenir l'accès.",
  },
};

/** The session columns that bind a session to one organization: single
 * sign-on asserts no role, an authenticating proxy asserts one and signs the
 * session in, and a passkey enrolled behind a proxy keeps the proxy's role as
 * the ceiling of each later sign-in, which its person made themselves. */
const SSO_SESSION = { trustedOrganizationId: 'org-a', trustedRole: null };
const PROXY_SESSION = {
  trustedOrganizationId: 'org-a',
  trustedRole: 'member',
  signedInByProxy: true,
};
const PASSKEY_SESSION = {
  trustedOrganizationId: 'org-a',
  trustedRole: 'member',
  signedInByProxy: false,
};

const MEMBERS = /^GET \/api\/app\/members\/me\?orgId=org-b$/;

/** The member door's refusals (`backend/auth/org.ts`,
 * `backend/auth/membership.ts`): the same status and code, told apart by
 * the session's sentence. */
function boundSessionRefusal(): Response {
  return Response.json(
    {
      error: 'ORG_FORBIDDEN',
      code: 'ORG_FORBIDDEN',
      message: SESSION_ORGANIZATION_MESSAGE,
    },
    { status: 403 },
  );
}

function notAMemberRefusal(): Response {
  return Response.json(
    { error: 'ORG_FORBIDDEN', message: 'Not a member of organization org-b' },
    { status: 403 },
  );
}

const DashboardLayout = (Route as unknown as { component: () => ReactNode })
  .component;

const realLocation = window.location;
const HERE = `${realLocation.origin}/dashboard/org-b`;
let page: {
  href: string;
  origin: string;
  pathname: string;
  search: string;
  hash: string;
};
let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  page = {
    href: HERE,
    origin: realLocation.origin,
    pathname: '/dashboard/org-b',
    search: '',
    hash: '',
  };
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...page,
      get href() {
        return page.href;
      },
      set href(value: string) {
        page.href = value;
      },
    },
  });
  backend = syntheticBackend();
  backend.on(/^GET \/api\/app\/users\/me$/, () =>
    Response.json({
      user: { userId: 'user-1', email: 'ada@example.com', name: 'Ada' },
    }),
  );
  backend.on(MEMBERS, () => boundSessionRefusal());
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
  h.signOut.mockReset();
  h.toast.mockReset();
  h.navigate.mockReset();
});

afterEach(async () => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: realLocation,
  });
  await forgetSavedLocale();
});

/** Open org-b's dashboard on a session whose columns carry `fields`. */
function renderDashboard(fields: Record<string, unknown>) {
  h.session = {
    data: {
      user: { id: 'user-1' },
      session: { activeOrganizationId: 'org-a', ...fields },
    },
    error: null,
  };
  client.setQueryData(sessionQueryOptions.queryKey, h.session);
  return render(
    <QueryClientProvider client={client}>
      <SessionLapseRecovery
        recovery={{
          isLapsed: false,
          open: false,
          checking: false,
          checkFailed: false,
          liveSessionVersion: 0,
          setOpen: vi.fn(),
          continueToLogIn: vi.fn(),
        }}
      >
        <DashboardLayout />
      </SessionLapseRecovery>
    </QueryClientProvider>,
  );
}

describe.each(SHIPPED_LOCALES)(
  'a member whose session another organization signed in (%s)',
  (locale) => {
    beforeEach(() => {
      saveLocale(locale);
    });

    it('names the session as what keeps them out and offers to sign in here', async () => {
      renderDashboard(SSO_SESSION);
      expect(
        await screen.findByText(RESTRICTED[locale].message),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: RESTRICTED[locale].action }),
      ).toBeEnabled();
      expect(
        screen.queryByText(RESTRICTED[locale].noMembership),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Page' }),
      ).not.toBeInTheDocument();
      expect(backend.count(MEMBERS)).toBe(1);
      expect(h.navigate).not.toHaveBeenCalled();
    });
  },
);

describe('the member door on another organization', () => {
  it('still tells someone who is not a member that they are not one', async () => {
    backend.on(MEMBERS, () => notAMemberRefusal());
    renderDashboard({});
    expect(
      await screen.findByText(RESTRICTED.en.noMembership),
    ).toBeInTheDocument();
    expect(screen.queryByText(RESTRICTED.en.message)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: RESTRICTED.en.action }),
    ).not.toBeInTheDocument();
  });

  it('offers no sign-in on a session an authenticating proxy signed in', async () => {
    renderDashboard(PROXY_SESSION);
    expect(await screen.findByText(RESTRICTED.en.message)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: RESTRICTED.en.action }),
    ).not.toBeInTheDocument();
  });

  it("offers sign-in on a passkey's session that keeps a proxy's role (#5259)", async () => {
    renderDashboard(PASSKEY_SESSION);
    expect(await screen.findByText(RESTRICTED.en.message)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: RESTRICTED.en.action }),
    ).toBeEnabled();
  });

  it('ends the session before it takes the tab to sign in, and back here', async () => {
    let hrefAtSignOut: string | undefined;
    h.signOut.mockImplementation(() => {
      hrefAtSignOut = page.href;
      return Promise.resolve({ data: { success: true }, error: null });
    });
    const { user } = renderDashboard(SSO_SESSION);
    await user.click(
      await screen.findByRole('button', { name: RESTRICTED.en.action }),
    );
    await waitFor(() => {
      expect(page.href).toBe('/log-in?redirectTo=%2Fdashboard%2Forg-b');
    });
    expect(h.signOut).toHaveBeenCalledOnce();
    expect(hrefAtSignOut).toBe(HERE);
    // The tab leaves: sign-out's hold on lapse redirects lets go with it.
    window.dispatchEvent(new Event('beforeunload'));
    await Promise.resolve();
  });

  it('keeps the person here and says so when the session will not end', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.signOut.mockResolvedValue({
      data: null,
      error: { message: 'Sign-out refused' },
    });
    const { user } = renderDashboard(SSO_SESSION);
    await user.click(
      await screen.findByRole('button', { name: RESTRICTED.en.action }),
    );
    await waitFor(() => {
      expect(h.toast).toHaveBeenCalledWith({
        title: "Couldn't sign out",
        variant: 'destructive',
      });
    });
    expect(warn).toHaveBeenCalledWith(
      '[auth] Ending the session to sign in again failed',
      expect.any(Error),
    );
    expect(
      screen.getByRole('button', { name: RESTRICTED.en.action }),
    ).toBeEnabled();
    expect(page.href).toBe(HERE);
  });
});
