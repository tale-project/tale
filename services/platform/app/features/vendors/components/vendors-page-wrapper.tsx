'use client';

import type { ReactNode } from 'react';

import { useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';

import { VendorsEmptyState } from './vendors-empty-state';

interface VendorsPageWrapperProps {
  organizationId: string;
  initialHasVendors: boolean;
  children: ReactNode;
}

/**
 * Client-side wrapper that reactively subscribes to hasVendors.
 * This allows the page to automatically transition between empty state
 * and vendors table when vendors are imported or all vendors are deleted.
 */
export function VendorsPageWrapper({
  organizationId,
  initialHasVendors,
  children,
}: VendorsPageWrapperProps) {
  // Subscribe to hasVendors for reactive updates
  // Convex useQuery automatically updates when data changes
  const hasVendors = useQuery(api.vendors.queries.hasVendors, {
    organizationId,
  });

  // Use initial value while loading, then use reactive value
  const showVendors = hasVendors ?? initialHasVendors;

  // Show empty state if no vendors
  if (!showVendors) {
    return <VendorsEmptyState organizationId={organizationId} />;
  }

  // Show the table (children) when vendors exist
  return <>{children}</>;
}
