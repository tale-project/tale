import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';

import { VStack, Spacer } from '@/app/components/ui/layout/layout';
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
      className="bg-background text-foreground min-h-screen"
    >
      <div className="px-4 pt-8 pb-16 sm:px-8 md:pb-32">
        <LogoLink href="/" />
      </div>
      <main id="main-content">
        <Outlet />
      </main>
      <Spacer />
    </VStack>
  );
}
