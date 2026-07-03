import { VStack, Spacer } from '@tale/ui/layout';
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';

import { LogoLink } from '@/app/components/ui/logo/logo-link';
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

function AuthLayout() {
  return (
    <VStack
      gap={0}
      align="stretch"
      className="bg-background text-foreground min-h-dvh"
    >
      <div className="pt-[calc(2rem+var(--safe-top))] pr-[calc(1rem+var(--safe-right))] pb-16 pl-[calc(1rem+var(--safe-left))] sm:pr-[calc(2rem+var(--safe-right))] sm:pl-[calc(2rem+var(--safe-left))] md:pb-32">
        <LogoLink href="/" />
      </div>
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <Spacer />
    </VStack>
  );
}
