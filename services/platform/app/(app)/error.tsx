'use client';

import Link from 'next/link';
import { UserButton } from '@/components/user-button';
import { TaleLogoText } from '@/components/ui/logo/tale-logo-text';
import { HStack, Spacer } from '@/components/ui/layout';
import { PageErrorBoundary } from '@/components/error-boundaries';

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset: _reset }: AppErrorProps) {
  return (
    <PageErrorBoundary
      error={error}
      header={
        <HStack className="pt-8 px-20">
          <Link href="/dashboard" className="hover:opacity-70">
            <TaleLogoText />
          </Link>
          <Spacer />
          <UserButton align="end" />
        </HStack>
      }
    />
  );
}
