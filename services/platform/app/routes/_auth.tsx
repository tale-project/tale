import {
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router';
import { useEffect } from 'react';

import { AuthPageLayout } from '@/app/features/auth/components/auth-page-layout';
import { AuthSsoHeader } from '@/app/features/auth/components/auth-sso-header';
import { resumeOAuthSignIn } from '@/app/features/auth/lib/resume-oauth';
import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import { clearMemberContextCache } from '@/app/lib/member-context-cache';

export const Route = createFileRoute('/_auth')({
  beforeLoad: async ({ context, location }) => {
    // fetchQuery rejects on transport failures (after retries) — treat that
    // as signed-out and show the auth page rather than a route error.
    const session = await context.queryClient
      .fetchQuery(sessionQueryOptions)
      .catch(() => null);
    if (session?.data?.user) {
      const returnTo = new URLSearchParams(location.searchStr).get(
        'redirectTo',
      );
      if (resumeOAuthSignIn(returnTo ?? undefined)) return;
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
    <AuthPageLayout header={ssoOrgPicker ? <AuthSsoHeader /> : undefined}>
      <Outlet />
    </AuthPageLayout>
  );
}
