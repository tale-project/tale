import { Outlet, createFileRoute } from '@tanstack/react-router';
import { VStack, Spacer } from '@/app/components/ui/layout/layout';
import { LogoLink } from '@/app/components/ui/logo/logo-link';

export const Route = createFileRoute('/_auth')({
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <VStack gap={0} align="stretch" className="min-h-screen bg-background text-foreground">
      <div className="pt-8 px-4 sm:px-8 pb-16 md:pb-32">
        <LogoLink href="/" />
      </div>
      <Outlet />
      <Spacer />
    </VStack>
  );
}
