# Convex Backend

Backend functions for the Tale platform. All queries and mutations are protected by row-level security (RLS).

## Architecture

```
Convex WebSocket → ConvexQueryClient → TanStack Query cache
  → QueryCollection → Collection sync store → Live Queries → UI
```

### Data Layer

- **Collections** (`lib/collections/`) provide real-time reactive data via TanStack DB, backed by Convex WebSocket subscriptions
- **Queries** return raw data without pagination, filtering, or sorting — all handled client-side via live queries
- **Mutations** are called via `useConvexMutation` — Convex WebSocket auto-syncs collections when mutations complete
- **Actions** are called via `useConvexAction` for operations with side effects (external APIs, bulk operations)

### Validation

Shared Zod schemas in `lib/shared/schemas/` are used on both client and server. On the server side, `zodToConvex()` bridges Zod schemas to Convex validators.

## Directory Structure

Each domain is organized as a folder with:

```
convex/
├── [domain]/
│   ├── schema.ts        # Table definition (defineTable)
│   ├── validators.ts    # Convex validators (from shared Zod schemas)
│   ├── queries.ts       # queryWithRLS functions
│   ├── mutations.ts     # mutationWithRLS functions
│   ├── actions.ts       # action functions (side effects)
│   └── [helpers].ts     # Business logic helpers
├── lib/
│   ├── rls/             # Row-level security wrappers
│   └── ...
└── schema.ts            # Root schema aggregating all tables
```

## Server-Side Patterns

### Query

```ts
// convex/customers/queries.ts
import { v } from 'convex/values';
import { queryWithRLS } from '../lib/rls/query_with_rls';

export const listCustomers = queryWithRLS({
  args: { organizationId: v.string() },
  returns: v.array(customerValidator),
  handler: async (ctx, args) => {
    const results = [];
    for await (const customer of ctx.db
      .query('customers')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      results.push(customer);
    }
    return results;
  },
});
```

### Mutation

```ts
// convex/customers/mutations.ts
import { v } from 'convex/values';
import { mutationWithRLS } from '../lib/rls/mutation_with_rls';

export const updateCustomer = mutationWithRLS({
  args: {
    customerId: v.id('customers'),
    name: v.optional(v.string()),
  },
  returns: v.union(customerValidator, v.null()),
  handler: async (ctx, args) => {
    const { customerId, ...updates } = args;
    await ctx.db.patch(customerId, updates);
    return await ctx.db.get(customerId);
  },
});
```

### Action

```ts
// convex/documents/actions.ts
import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';

export const retryRagIndexing = action({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.object({
    success: v.boolean(),
    jobId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Actions can call queries/mutations and interact with external systems
    const document = await ctx.runQuery(
      internal.documents.internal_queries.getDocumentByIdRaw,
      { documentId: args.documentId },
    );

    if (!document) {
      return { success: false, error: 'Document not found' };
    }

    const result = await ragAction.execute(ctx, {
      operation: 'upload_document',
      recordId: args.documentId,
    });

    return { success: result.success, jobId: result.jobId };
  },
});
```

## Client-Side Patterns

### Collection (real-time list data)

Collections are the primary way to consume list data. They provide live, reactive queries powered by TanStack DB.

```ts
// features/customers/hooks/collections.ts
export function createCustomersCollection(queryClient, convexQueryFn, scopeId) {
  return convexCollectionOptions({
    id: 'customers',
    queryFn: api.customers.queries.listCustomers,
    args: { organizationId: scopeId },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
  });
}

// features/customers/hooks/use-customer-collection.ts
export function useCustomerCollection(organizationId: string) {
  return useCollection('customers', createCustomersCollection, organizationId);
}
```

### Live Queries (filtering, sorting, joining)

```ts
// features/customers/hooks/queries.ts
export function useCustomers(collection: Collection<Customer, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ customer: collection }).select(({ customer }) => customer),
  );
  return { customers: data, isLoading };
}

export function useCustomerByEmail(collection, email: string | undefined) {
  const { data } = useLiveQuery(
    (q) => q.from({ c: collection }).fn.where((row) => row.c.email === email),
    [email],
  );
  return useMemo(() => data?.[0] ?? null, [data]);
}
```

### Mutations (via Convex WebSocket)

```ts
// features/customers/hooks/mutations.ts
export function useUpdateCustomer() {
  return useConvexMutation(api.customers.mutations.updateCustomer);
}
```

### Actions (for side effects)

```ts
// features/documents/hooks/actions.ts
export function useRetryRagIndexing() {
  return useConvexAction(api.documents.actions.retryRagIndexing);
}
```

### Standalone Queries (non-collection)

For singleton data or queries that don't fit the collection pattern:

```ts
export function useCurrentUser() {
  return useConvexQuery(api.auth.queries.getCurrentUser);
}
```

## Key Rules

- **Never use `.collect()`** — use `for await (const item of query)` instead
- **Always use `queryWithRLS` / `mutationWithRLS`** for authenticated endpoints
- **Backend returns raw data only** — no pagination, filtering, or sorting server-side
- **Share validation schemas** via `lib/shared/schemas/` between client and server
- **No deprecated functions** — remove them entirely instead of marking `@deprecated`
