/**
 * Get customer statistics for an organization (business logic)
 */

import type { QueryCtx } from '../../_generated/server';

import type { CustomerStats } from './types';

export async function getCustomerStats(
  ctx: QueryCtx,
  organizationId: string,
): Promise<CustomerStats> {
  const customers = await ctx.db
    .query('customers')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    )
    .collect();

  const stats: CustomerStats = {
    total: customers.length,
    active: customers.filter((c) => c.status === 'active').length,
    churned: customers.filter((c) => c.status === 'churned').length,
    potential: customers.filter((c) => c.status === 'potential').length,
    totalSpent: customers.reduce((sum, c) => sum + (c.totalSpent || 0), 0),
    averageOrderValue: 0,
  };

  const totalOrders = customers.reduce(
    (sum, c) => sum + (c.orderCount || 0),
    0,
  );
  if (totalOrders > 0) {
    stats.averageOrderValue = stats.totalSpent / totalOrders;
  }

  return stats;
}
