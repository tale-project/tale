/**
 * Organization-scoped query builder
 * Updated to use Better Auth's string-based organization IDs
 */

import type { QueryCtx } from '../../../_generated/server';

/**
 * Organization-scoped query builder
 */
export class OrganizationQueryBuilder {
  constructor(
    private ctx: QueryCtx,
    private organizationId: string,
  ) {}

  /**
   * Query documents for organization
   */
  documents() {
    return this.ctx.db
      .query('documents')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', this.organizationId),
      );
  }

  /**
   * Query products for organization
   */
  products() {
    return this.ctx.db
      .query('products')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', this.organizationId),
      );
  }

  /**
   * Query customers for organization
   */
  customers() {
    return this.ctx.db
      .query('customers')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', this.organizationId),
      );
  }

  /**
   * Query integrations for organization
   */
  integrations() {
    return this.ctx.db
      .query('integrations')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', this.organizationId),
      );
  }

  /**
   * Query conversations for organization
   */
  conversations() {
    return this.ctx.db
      .query('conversations')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', this.organizationId),
      );
  }

  /**
   * Query workflow definitions for organization
   */
  wfDefinitions() {
    return this.ctx.db
      .query('wfDefinitions')
      .withIndex('by_org', (q) => q.eq('organizationId', this.organizationId));
  }

  /**
   * Query workflow executions for organization
   */
  wfExecutions() {
    return this.ctx.db
      .query('wfExecutions')
      .withIndex('by_org', (q) => q.eq('organizationId', this.organizationId));
  }

  /**
   * Query workflow approvals for organization
   */
  approvals() {
    return this.ctx.db
      .query('approvals')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', this.organizationId),
      );
  }
}

/**
 * Create organization-scoped query builder
 */
export function createOrgQueryBuilder(
  ctx: QueryCtx,
  organizationId: string,
): OrganizationQueryBuilder {
  return new OrganizationQueryBuilder(ctx, organizationId);
}
