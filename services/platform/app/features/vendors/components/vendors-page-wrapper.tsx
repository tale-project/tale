'use client';

import type { ReactNode } from 'react';

import { useVendorCollection, useVendors } from '../hooks/collections';
import { VendorsEmptyState } from './vendors-empty-state';

interface VendorsPageWrapperProps {
  organizationId: string;
  children: ReactNode;
}

export function VendorsPageWrapper({
  organizationId,
  children,
}: VendorsPageWrapperProps) {
  const vendorCollection = useVendorCollection(organizationId);
  const { vendors } = useVendors(vendorCollection);
  const hasVendors = (vendors?.length ?? 0) > 0;

  if (!hasVendors) {
    return <VendorsEmptyState organizationId={organizationId} />;
  }

  return <>{children}</>;
}
