'use client';

import { UserButton } from '@/components/user-button';
import { StatusPageHeader } from '@/components/layout/status-page-header';
import { PageErrorBoundary } from '@/components/error-boundaries/boundaries/page-error-boundary';

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset: _reset }: AppErrorProps) {
  return (
    <PageErrorBoundary
      error={error}
      header={
        <StatusPageHeader logoHref="/dashboard">
          <UserButton align="end" />
        </StatusPageHeader>
      }
    />
  );
}
