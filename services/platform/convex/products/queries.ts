import { v } from 'convex/values';

import { hasRecordsInOrg } from '../lib/helpers/has_records_in_org';
import { cursorPaginationOptsValidator } from '../lib/pagination';
import { queryWithRLS } from '../lib/rls';
import * as ProductsHelpers from './helpers';
import { productDocValidator, productItemValidator } from './validators';

export const hasProducts = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await hasRecordsInOrg(ctx.db, 'products', args.organizationId);
  },
});

export const getProduct = queryWithRLS({
  args: {
    productId: v.id('products'),
  },
  returns: productItemValidator,
  handler: async (ctx, args) => {
    return await ProductsHelpers.getProduct(ctx, args.productId);
  },
});

export const listProducts = queryWithRLS({
  args: {
    organizationId: v.string(),
    paginationOpts: cursorPaginationOptsValidator,
  },
  returns: v.object({
    page: v.array(productDocValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    return await ProductsHelpers.listByOrganization(ctx, args);
  },
});
