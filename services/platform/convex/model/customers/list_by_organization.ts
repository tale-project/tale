/**
 * List customers by organization with pagination and field projection
 */

import type { QueryCtx } from '../../_generated/server';

export interface ListByOrganizationArgs {
  organizationId: string;
  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
  fields?: string[];
}

export interface ListByOrganizationResult {
  page: Array<Record<string, unknown>>;
  isDone: boolean;
  continueCursor: string | null;
}

export async function listByOrganization(
  ctx: QueryCtx,
  args: ListByOrganizationArgs,
): Promise<ListByOrganizationResult> {
  const result = await ctx.db
    .query('customers')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .paginate(args.paginationOpts);

  // If fields are specified, project only those fields
  if (args.fields && args.fields.length > 0) {
    const projectedPage = result.page.map((customer) => {
      const projected: Record<string, unknown> = {};
      for (const field of args.fields!) {
        if (field in customer) {
          projected[field] = customer[field as keyof typeof customer];
        }
      }
      return projected;
    });

    return {
      page: projectedPage,
      isDone: result.isDone,
      continueCursor: result.continueCursor ?? null,
    };
  }

  return {
    page: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor ?? null,
  };
}
