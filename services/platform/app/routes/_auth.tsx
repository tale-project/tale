import { VStack, Spacer } from '@tale/ui/layout';
import {
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router';
import { useEffect } from 'react';

import { LogoLink } from '@/app/components/ui/logo/logo-link';
import { AuthSsoHeader } from '@/app/features/auth/components/auth-sso-header';
import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import { clearMemberContextCache } from '@/app/lib/member-context-cache';

export const Route = createFileRoute('/_auth')({
  beforeLoad: async ({ context }) => {
    // fetchQuery rejects on transport failures (after retries) — treat that
    // as signed-out and show the auth page rather than a route error.
    const session = await context.queryClient
      .fetchQuery(sessionQueryOptions)
      .catch(() => null);
    if (session?.data?.user) {
      throw redirect({ to: '/dashboard' });
    }
  },
  component: AuthLayout,
});

function isSsoOrgPickerStep(pathname: string, searchStr: string): boolean {
  const onLogIn = pathname === '/log-in' || pathname.endsWith('/log-in');
  if (!onLogIn) return false;
  return new URLSearchParams(searchStr).get('method') === 'sso';
}

function AuthLayout() {
  // An auth screen is the only same-tab door to a user switch: drop the
  // pre-auth cache so the next sign-in can never hydrate the dashboard
  // shell as the previous account (see member-context-cache, epic #2386).
  useEffect(() => {
    clearMemberContextCache();
  }, []);

  const { pathname, searchStr } = useRouterState({
    select: (state) => ({
      pathname: state.location.pathname,
      searchStr: state.location.searchStr,
    }),
  });
  const ssoOrgPicker = isSsoOrgPickerStep(pathname, searchStr);

  return (
    <VStack
      gap={0}
      align="stretch"
      className="bg-background text-foreground min-h-dvh"
    >
      {ssoOrgPicker ? (
        <AuthSsoHeader />
      ) : (
        <div className="pt-[calc(2rem+var(--safe-top))] pr-[calc(1rem+var(--safe-right))] pb-16 pl-[calc(1rem+var(--safe-left))] sm:pr-[calc(2rem+var(--safe-right))] sm:pl-[calc(2rem+var(--safe-left))] md:pb-32">
          <LogoLink href="/" />
        </div>
      )}
      {/* outline-none: skip-link target focused only programmatically — the
          browser's focus ring would outline the whole page body. */}
      <main id="main-content" tabIndex={-1} className="outline-none">
        <Outlet />
      </main>
      <Spacer />
    </VStack>
  );
}
