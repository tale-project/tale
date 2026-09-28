import { DirtyBlockerProvider } from '@tale/ui/editor/dirty-blocker-provider';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  session: { isAuthenticated: true, isLoading: false },
  outlet: (): ReactNode => null,
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
  redirect: vi.fn(),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ status: 'idle' }),
  Outlet: () => h.outlet(),
}));
vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({ t: (key: string) => `${ns}.${key}` }),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: h.getSession, $store: { notify: vi.fn() } },
}));
vi.mock('@/app/hooks/use-session-user', () => ({
  useSessionUser: () => h.session,
}));
vi.mock('@/app/hooks/use-session-idle-watchdog', () => ({
  useSessionIdleWatchdog: () => undefined,
}));
vi.mock('@/app/components/layout/dashboard-shell-frame', () => ({
  DashboardShellFrame: () => null,
}));
vi.mock('@/app/context/account-bootstrap-context', () => ({
  useTwoFactorStatus: () => ({ authenticated: true, decision: 'allowed' }),
}));
vi.mock('@/app/context/account-bootstrap-provider', () => ({
  AccountBootstrapProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/app/features/products/hooks/use-product-image-upload', () => ({
  PRODUCT_IMAGE_ACCEPT: 'image/*',
  PRODUCT_IMAGE_MAX_BYTES: 5_000_000,
  useProductImageUpload: () => ({ uploadImage: vi.fn(), isUploading: false }),
}));
vi.mock('@/app/features/products/hooks/mutations', () => ({
  useCreateProduct: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ProductCreateDialog } from '@/app/features/products/components/product-create-dialog';
import { backendApiErrorFromBody } from '@/app/lib/backend/api-client';
import { LAPSED_SESSION_ANSWER } from '@/tests/utils/lapsed-session';

import { Route } from './dashboard';

const realLocation = window.location;
let href: string;
const Dashboard = (Route as unknown as { component: () => ReactNode })
  .component;
const lapse = () =>
  act(() => {
    backendApiErrorFromBody(
      LAPSED_SESSION_ANSWER.status,
      LAPSED_SESSION_ANSWER.body,
    );
  });
beforeEach(() => {
  h.getSession.mockReset().mockResolvedValue({ data: null, error: null });
  h.session = { isAuthenticated: true, isLoading: false };
  href = '/dashboard/org-1/products';
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      pathname: href,
      search: '',
      hash: '',
      get href() {
        return href;
      },
      set href(value: string) {
        href = value;
      },
    },
  });
  h.outlet = () => (
    <DirtyBlockerProvider>
      <ProductCreateDialog isOpen onClose={vi.fn()} organizationId="org-1" />
    </DirtyBlockerProvider>
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: realLocation,
  });
});

describe('confirmed session lapse with an unregistered product draft', () => {
  it.each(['before', 'during'] as const)(
    'preserves input typed %s the recheck and asks before leaving',
    async (timing) => {
      let resolve = (_answer: { data: null; error: null }) => {};
      if (timing === 'during')
        h.getSession.mockReturnValueOnce(
          new Promise((done) => {
            resolve = done;
          }),
        );
      const user = userEvent.setup();
      render(<Dashboard />);
      const name = screen.getByLabelText('products.edit.labels.name', {
        exact: false,
      });
      const description = screen.getByLabelText(
        'products.edit.labels.description',
        { exact: false },
      );
      if (timing === 'during') lapse();
      await user.type(name, 'Unfinished product');
      await user.type(description, 'Copy this before signing in.');
      if (timing === 'before') lapse();
      else await act(async () => resolve({ data: null, error: null }));
      const stay = await screen.findByRole('button', {
        name: 'auth.sessionLapse.stayHere',
      });
      expect(href).toBe('/dashboard/org-1/products');
      await user.click(stay);
      await waitFor(() => expect(description).toHaveFocus());
      expect(name).toHaveValue('Unfinished product');
      expect(description).toHaveValue('Copy this before signing in.');
      lapse();
      lapse();
      await waitFor(() => expect(h.getSession).toHaveBeenCalledTimes(2));
      expect(
        screen.queryByRole('button', { name: 'auth.sessionLapse.stayHere' }),
      ).not.toBeInTheDocument();
      expect(href).toBe('/dashboard/org-1/products');
      const reopen = screen.getByRole('button', {
        name: 'auth.sessionLapse.signIn',
        hidden: true,
      });
      fireEvent.click(reopen);
      await user.click(
        await screen.findByRole('button', { name: 'auth.sessionLapse.signIn' }),
      );
      await waitFor(() =>
        expect(href).toBe(
          '/log-in?redirectTo=%2Fdashboard%2Forg-1%2Fproducts&reason=session-ended',
        ),
      );
    },
  );
  it('keeps the mounted draft when the dashboard probe also becomes unauthenticated', async () => {
    const view = render(<Dashboard />);
    const name = screen.getByLabelText('products.edit.labels.name', {
      exact: false,
    });
    fireEvent.change(name, { target: { value: 'Keep this draft' } });
    h.session = { isAuthenticated: false, isLoading: false };
    view.rerender(<Dashboard />);
    await screen.findByRole('button', { name: 'auth.sessionLapse.stayHere' });
    expect(name).toBeInTheDocument();
    expect(name).toHaveValue('Keep this draft');
    expect(href).toBe('/dashboard/org-1/products');
  });
});
