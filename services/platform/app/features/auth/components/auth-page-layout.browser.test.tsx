import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { Route as AuthRoute } from '@/app/routes/_auth';
import { render, screen } from '@/tests/utils/render';

import { AuthFormLayout } from './auth-form-layout';
import { OAuthAuthorization } from './oauth-authorization';

import '@/app/globals.css';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => ({ pathname: '/log-in', searchStr: '' }),
  Link: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  Outlet: () => (
    <AuthFormLayout title="Log in">
      <input aria-label="Email" />
    </AuthFormLayout>
  ),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: () => new Promise(() => {}), oauth2: {} },
}));
vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({}),
}));

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

function bounds(element: Element) {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}

describe('OAuth login page geometry', () => {
  for (const dark of [false, true]) {
    for (const width of [390, 1280]) {
      it(`keeps the logo and title anchored at ${width}px (${dark ? 'dark' : 'light'})`, async () => {
        await page.viewport(width, 900);
        document.documentElement.classList.toggle('dark', dark);
        const AuthLayout = AuthRoute.options.component;
        if (!AuthLayout) throw new Error('Auth layout missing');
        const { rerender } = render(<AuthLayout />);
        await document.fonts.ready;
        const logo = bounds(screen.getByRole('link'));
        const heading = bounds(screen.getByRole('heading', { level: 1 }));

        rerender(<OAuthAuthorization consent={false} />);

        expect(bounds(screen.getByRole('link'))).toEqual(logo);
        expect(bounds(screen.getByRole('heading', { level: 1 }))).toEqual(
          heading,
        );
        expect(document.documentElement.scrollWidth).toBe(width);
      });
    }
  }
});
