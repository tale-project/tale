'use client';

import { DashboardErrorBoundary } from '@/components/error-boundary';
import { useParams } from 'next/navigation';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardError({ error, reset: _reset }: ErrorProps) {
  const params = useParams();
  const organizationId = params.id as string | undefined;

  return (
    <DashboardErrorBoundary error={error} organizationId={organizationId} />
  );
}
