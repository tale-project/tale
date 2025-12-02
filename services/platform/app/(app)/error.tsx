'use client';

import Link from 'next/link';
import { UserButton } from '@/components/auth/user-button';
import { TaleLogoText } from '@/components/tale-logo-text';
import { DashboardErrorBoundary } from '@/components/error-boundary';

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: AppErrorProps) {
  return (
    <section>
      <DashboardErrorBoundary
        error={error}
        header={
          <div className="pt-8 px-20 flex items-center">
            <Link href="/dashboard" className="hover:opacity-70">
              <TaleLogoText />
            </Link>
            <span className="ml-auto">
              <UserButton align="end" />
            </span>
          </div>
        }
      />
    </section>
  );
}
