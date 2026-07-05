import { VStack, Spacer } from '@tale/ui/layout';
import {
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router';

import { LogoLink } from '@/app/components/ui/logo/logo-link';
import { AuthSsoHeader } from '@/app/features/auth/components/auth-sso-header';
import { sessionQueryOptions } from '@/app/lib/auth/session-query';

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
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <Spacer />
    </VStack>
  );
}
