'use client';

import { VStack, Spacer } from '@/components/ui/layout/layout';
import { LogoLink } from '@/components/ui/logo/logo-link';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <VStack gap={0} align="stretch" className="min-h-screen bg-background text-foreground">
      <div className="pt-8 px-4 sm:px-8 pb-16 md:pb-32">
        <LogoLink href="/" />
      </div>
      {children}
      <Spacer />
    </VStack>
  );
}
