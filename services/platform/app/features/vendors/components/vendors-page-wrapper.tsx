'use client';

import type { ReactNode } from 'react';

import { useVendors } from '../hooks/queries';
import { VendorsEmptyState } from './vendors-empty-state';

interface VendorsPageWrapperProps {
  organizationId: string;
  children: ReactNode;
}

export function VendorsPageWrapper({
  organizationId,
  children,
}: VendorsPageWrapperProps) {
  const { vendors } = useVendors(organizationId);
  const hasVendors = (vendors?.length ?? 0) > 0;

  if (!hasVendors) {
    return <VendorsEmptyState organizationId={organizationId} />;
  }

  return <>{children}</>;
}
