import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import { i18n } from '@/tests/utils/i18n-all-languages';
import { render, screen } from '@/tests/utils/render';

const h = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => h.navigate,
  useLocation: () => ({ href: '/dashboard/org-acme/settings/account' }),
}));
// The panel's reads wait for a signed-in session; this one is.
vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ isLoading: false, isAuthenticated: true }),
}));

import { OrganizationListPanel } from './organization-list-panel';

const acme = {
  organizationId: 'org-acme',
  role: 'owner',
  name: 'Acme',
  slug: 'acme',
};
const globex = {
  organizationId: 'org-globex',
  role: 'member',
  name: 'Globex',
  slug: 'globex',
};

let queryClient: QueryClient;
let fetch: MockInstance<typeof globalThis.fetch>;
let organizationsAnswer: () => Response | Promise<Response>;

function pathOf(input: Parameters<typeof globalThis.fetch>[0]): string {
  const url = input instanceof Request ? input.url : String(input);
  return new URL(url, 'http://tale.test').pathname;
}
const organizationReads = () =>
  fetch.mock.calls.filter(
    ([input]) => pathOf(input) === '/api/app/organizations',
  ).length;

function renderPanel() {
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationListPanel currentOrganizationId="org-acme" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // The list keeps its own retry policy; only its pause between attempts is
  // cut short here.
  queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
  organizationsAnswer = () => Response.json({ organizations: [acme, globex] });
  fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = pathOf(input);
    if (path === '/api/app/organizations') return organizationsAnswer();
    if (path === '/api/app/organizations/capabilities') {
      return Response.json({ canCreate: true });
    }
    throw new Error(`Unexpected request to ${path}`);
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  localStorage.removeItem('user-locale');
  await i18n.changeLanguage('en');
});

describe('the organization switcher', () => {
  it('names each role in the reader’s language', async () => {
    localStorage.setItem('user-locale', 'de');
    await i18n.changeLanguage('de');
    renderPanel();
    expect(await screen.findByText('@acme · Inhaber')).toBeInTheDocument();
    expect(screen.getByText('@globex · Mitglied')).toBeInTheDocument();
  });

  it('says the list could not be loaded, with Try again, instead of listing nothing', async () => {
    organizationsAnswer = () =>
      Response.json(
        { error: 'UPSTREAM_UNAVAILABLE', message: 'Upstream restarting' },
        { status: 503 },
      );
    const { user } = renderPanel();
    expect(
      await screen.findByText('Your organizations could not be loaded.'),
    ).toBeInTheDocument();
    // The first read and the three retries of a fault.
    expect(organizationReads()).toBe(4);
    // Creating an organization stays on offer.
    expect(
      screen.getByRole('button', { name: 'Create organization' }),
    ).toBeInTheDocument();

    organizationsAnswer = () =>
      Response.json({ organizations: [acme, globex] });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('button', { name: /Globex/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Your organizations could not be loaded.'),
    ).not.toBeInTheDocument();
  });
});
