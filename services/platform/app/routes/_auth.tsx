import { VStack, Spacer } from '@tale/ui/layout';
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';

import { LogoLink } from '@/app/components/ui/logo/logo-link';
import { authClient } from '@/lib/auth-client';

export const Route = createFileRoute('/_auth')({
  beforeLoad: async () => {
    const session = await authClient.getSession();
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
      <main id="main-content">
        <Outlet />
      </main>
      <Spacer />
    </VStack>
  );
}
