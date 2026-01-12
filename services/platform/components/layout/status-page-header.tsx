'use client';

import { ReactNode } from 'react';
import { HStack, Spacer } from '@/components/ui/layout/layout';
import { LogoLink } from '@/components/ui/logo/logo-link';

interface StatusPageHeaderProps {
  /** Target URL for the logo link */
  logoHref: string;
  /** Right side content (e.g., UserButton, login button) */
  children: ReactNode;
}

/**
 * Header component for status pages (error, not-found, etc.)
 * Provides consistent spacing and logo positioning.
 */
export function StatusPageHeader({ logoHref, children }: StatusPageHeaderProps) {
  return (
    <HStack className="pt-8 px-4 sm:px-8 md:px-20">
      <LogoLink href={logoHref} />
      <Spacer />
      {children}
    </HStack>
  );
}
