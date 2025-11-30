# Row Level Security (RLS) Implementation Guide

This guide provides a complete solution for implementing Row Level Security in your Convex application using the [convex-helpers](https://stack.convex.dev/row-level-security) approach, ensuring users can only access data from their organizations.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Core Library](#core-library)
3. [Implementation Patterns](#implementation-patterns)
4. [Migration Guide](#migration-guide)
5. [Best Practices](#best-practices)
6. [Troubleshooting](#troubleshooting)

## Quick Start

**The only file you need**: `convex/lib/rls-helpers.ts` provides everything for secure RLS using convex-helpers.

```typescript
// Simple, secure RLS pattern - authorization happens automatically!
import { queryWithRLS, mutationWithRLS } from './lib/rls-helpers';

export const listDocuments = queryWithRLS({
  args: { organizationId: v.id('organizations') },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    // RLS automatically validates access and filters results
    return await ctx.db
      .query('documents')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .collect();
  },
});
```

**Key Benefits:**

- **🔒 Security**: Automatic organization isolation at the database layer
- **⚡ Performance**: No performance overhead - rules check only accessed documents
- **🛠 Type Safety**: Full TypeScript support with proper error handling
- **📈 Scalable**: Authorization checked per-document as needed
- **🎯 Simple**: No manual validation needed - just use `queryWithRLS`/`mutationWithRLS`

## Core Library

**File**: `convex/lib/rls-helpers.ts` - This wraps your database with automatic RLS enforcement.

### Essential Functions

```typescript
// 🔑 Core wrappers - use these instead of query/mutation
import { queryWithRLS, mutationWithRLS } from './lib/rls-helpers';

// All database operations automatically check RLS rules
export const myQuery = queryWithRLS({
  args: { organizationId: v.id('organizations') },
  handler: async (ctx, args) => {
    // ctx.db is wrapped - all queries automatically filtered
    return await ctx.db.query('documents').collect();
  },
});

// 🛠 Helper functions (optional, for custom logic)
import { getAuthUser, getUserOrganizations } from './lib/rls-helpers';

const user = await getAuthUser(ctx); // Get current user (returns null if not authenticated)
const orgs = await getUserOrganizations(ctx); // Get user's organizations
```

### How It Works

The RLS system uses `convex-helpers` to wrap the database context:

1. **Custom Wrappers**: `queryWithRLS` and `mutationWithRLS` wrap the standard Convex functions
2. **Database Interception**: `ctx.db` is wrapped to intercept all database operations
3. **Automatic Filtering**: Every `db.get()`, `db.query()`, `db.patch()`, `db.delete()`, and `db.insert()` is checked against RLS rules
4. **Centralized Rules**: All rules defined in one place (`rls-helpers.ts`)

### Multi-Tenant Data Model

```typescript
// Every business entity includes organizationId
interface BusinessEntity {
  organizationId: Id<'organizations'>;
  // ... other fields
}

// Users belong to organizations through membership
interface Member {
  organizationId: Id<'organizations'>;
  identityId: string; // Links to auth user
  role: 'Owner' | 'Admin' | 'Developer' | 'Member';
}
```

### Security Flow

1. **Authentication**: Verify user identity using Better Auth
2. **Organization Membership**: Load user's organizations and roles
3. **Database Wrapping**: Wrap `ctx.db` with RLS enforcement
4. **Automatic Filtering**: Each database operation checks access rules

### RLS Rules

Rules are defined in `convex/lib/rls-helpers.ts`:

```typescript
const rules = {
  documents: {
    read: async (rlsCtx, document) => {
      if (!rlsCtx.user) return false;
      return userOrgIds.has(document.organizationId);
    },
    modify: async (rlsCtx, document) => {
      if (!rlsCtx.user) return false;
      return userOrgIds.has(document.organizationId);
    },
    insert: async (rlsCtx, document) => {
      if (!rlsCtx.user) return false;
      return userOrgIds.has(document.organizationId);
    },
  },
  // ... rules for other tables
};
```

## Implementation Patterns

### Pattern 1: Simple Organization Query

```typescript
import { queryWithRLS } from './lib/rls-helpers';

export const listDocuments = queryWithRLS({
  args: { organizationId: v.id('organizations') },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    // RLS automatically filters to only documents user can access
    return await ctx.db
      .query('documents')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')
      .take(20);
  },
});
```

### Pattern 2: Resource Update (Automatic Validation)

```typescript
import { mutationWithRLS } from './lib/rls-helpers';

export const updateDocument = mutationWithRLS({
  args: {
    documentId: v.id('documents'),
    title: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // RLS automatically validates user has access before allowing the patch
    const document = await ctx.db.get(args.documentId);
    if (!document) {
      throw new Error('Document not found');
    }

    // This will throw if user doesn't have modify permission
    await ctx.db.patch(args.documentId, {
      title: args.title,
    });

    return null;
  },
});
```

### Pattern 3: Cross-Resource Query

```typescript
import { queryWithRLS } from './lib/rls-helpers';

export const getOrganizationStats = queryWithRLS({
  args: { organizationId: v.id('organizations') },
  returns: v.object({
    totalCustomers: v.number(),
    totalProducts: v.number(),
    totalDocuments: v.number(),
  }),
  handler: async (ctx, args) => {
    // All queries automatically filtered to user's accessible data
    const [customers, products, documents] = await Promise.all([
      ctx.db
        .query('customers')
        .withIndex('by_organizationId', (q) =>
          q.eq('organizationId', args.organizationId),
        )
        .collect(),
      ctx.db
        .query('products')
        .withIndex('by_organizationId', (q) =>
          q.eq('organizationId', args.organizationId),
        )
        .collect(),
      ctx.db
        .query('documents')
        .withIndex('by_organizationId', (q) =>
          q.eq('organizationId', args.organizationId),
        )
        .collect(),
    ]);

    return {
      totalCustomers: customers.length,
      totalProducts: products.length,
      totalDocuments: documents.length,
    };
  },
});
```

### Pattern 4: Unauthenticated Queries

```typescript
import { queryWithRLS, getAuthUser } from './lib/rls-helpers';

export const listPublicDocuments = queryWithRLS({
  args: { organizationId: v.id('organizations') },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    // Check if user is authenticated
    const user = await getAuthUser(ctx);
    if (!user) {
      // Return empty array for unauthenticated users
      return [];
    }

    // RLS automatically filters
    return await ctx.db
      .query('documents')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .collect();
  },
});
```

## Migration Guide

### Step 1: Update Imports

**Before** (Old manual validation):

```typescript
import { query, mutation } from './_generated/server';
import { validateOrganizationAccess } from './lib/rls';
```

**After** (New automatic RLS):

```typescript
import { queryWithRLS, mutationWithRLS } from './lib/rls-helpers';
```

### Step 2: Replace Function Wrappers

**Before** (Manual validation):

```typescript
export const getDocuments = query({
  args: { organizationId: v.id('organizations') },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    // Manual validation required
    await validateOrganizationAccess(ctx, args.organizationId);

    return await ctx.db
      .query('documents')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .collect();
  },
});
```

**After** (Automatic RLS):

```typescript
export const getDocuments = queryWithRLS({
  args: { organizationId: v.id('organizations') },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    // No manual validation needed - RLS handles it automatically!
    return await ctx.db
      .query('documents')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .collect();
  },
});
```

### Step 3: Remove Manual Auth Checks

**Before** (Manual checks):

```typescript
export const createDocument = mutation({
  args: { organizationId: v.id('organizations'), title: v.string() },
  handler: async (ctx, args) => {
    // Manual authentication check
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    // Manual membership check
    const member = await ctx.db
      .query('members')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .filter((q) => q.eq(q.field('identityId'), authUser.userId))
      .first();

    if (!member) {
      throw new Error('Not authorized');
    }

    return await ctx.db.insert('documents', {
      organizationId: args.organizationId,
      title: args.title,
    });
  },
});
```

**After** (Automatic RLS):

```typescript
export const createDocument = mutationWithRLS({
  args: { organizationId: v.id('organizations'), title: v.string() },
  returns: v.id('documents'),
  handler: async (ctx, args) => {
    // RLS automatically validates authentication and authorization
    return await ctx.db.insert('documents', {
      organizationId: args.organizationId,
      title: args.title,
    });
  },
});
```

### Step 4: Test Your Migration

```typescript
// Test: User cannot access other organization's data
test('RLS blocks cross-organization access', async () => {
  try {
    await testQuery(api.documents.getDocuments, {
      organizationId: otherOrganizationId,
    });
    // Should return empty array or throw error
  } catch (error) {
    // RLS automatically prevents access
    expect(error).toBeDefined();
  }
});
```

## Best Practices

### 1. Always Use RLS Wrappers

```typescript
// ❌ Bad: Manual validation prone to errors
import { query } from './_generated/server';

export const badQuery = query({
  handler: async (ctx, args) => {
    await validateOrganizationAccess(ctx, args.organizationId);
    return await ctx.db.query('documents').collect();
  },
});

// ✅ Good: Automatic RLS enforcement
import { queryWithRLS } from './lib/rls-helpers';

export const goodQuery = queryWithRLS({
  args: { organizationId: v.id('organizations') },
  handler: async (ctx, args) => {
    // RLS automatically validates and filters
    return await ctx.db
      .query('documents')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .collect();
  },
});
```

### 2. Centralize RLS Rules

All authorization rules are defined in `convex/lib/rls-helpers.ts`. To add new table rules:

```typescript
const rules = {
  // Add your new table here
  myNewTable: {
    read: async (rlsCtx, row) => {
      if (!rlsCtx.user) return false;
      return userOrgIds.has(row.organizationId);
    },
    modify: async (rlsCtx, row) => {
      if (!rlsCtx.user) return false;
      return userOrgIds.has(row.organizationId);
    },
    insert: async (rlsCtx, row) => {
      if (!rlsCtx.user) return false;
      return userOrgIds.has(row.organizationId);
    },
  },
};
```

### 3. Role-Based Rules

Different tables can have different role requirements:

```typescript
// In rls-helpers.ts
integrations: {
  read: async (rlsCtx, integration) => {
    if (!rlsCtx.user) return false;
    return userOrgIds.has(integration.organizationId);
  },
  modify: async (rlsCtx, integration) => {
    if (!rlsCtx.user) return false;
    if (!userOrgIds.has(integration.organizationId)) return false;

    // Require Developer, Admin, or Owner role for integrations
    const membership = userOrganizations.find(
      (m) => m.organizationId === integration.organizationId,
    );
    return (
      membership?.role === 'Owner' ||
      membership?.role === 'Admin' ||
      membership?.role === 'Developer'
    );
  },
},
```

**Role Hierarchy** (higher roles inherit lower permissions):

- **Member**: Regular member with basic operation permissions
- **Developer**: Developer with access to technical settings
- **Admin**: Administrator who can manage business settings
- **Owner**: Organization owner with full permissions

### 4. Optimize Queries with Proper Indexing

```typescript
// Ensure all organization-scoped tables have proper indexes
documents: defineTable({
  organizationId: v.id('organizations'),
  // ... other fields
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_kind', ['organizationId', 'kind']);
```

### 5. Handle Errors Gracefully

```typescript
import { queryWithRLS } from './lib/rls-helpers';

export const getDocument = queryWithRLS({
  args: { documentId: v.id('documents') },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    // RLS will return null if user doesn't have access
    const document = await ctx.db.get(args.documentId);

    if (!document) {
      // Could be not found OR no access - both return null
      return null;
    }

    return document;
  },
});
```

## Troubleshooting

### Performance Issues

**Problem**: "Function execution timed out"

**Solution**: RLS rules are efficient because they only check documents that are actually accessed. However, ensure you're using indexes:

```typescript
// ❌ Bad: Full table scan
const documents = await ctx.db.query('documents').collect(); // Checks EVERY document against RLS rules

// ✅ Good: Indexed query
const documents = await ctx.db
  .query('documents')
  .withIndex('by_organizationId', (q) =>
    q.eq('organizationId', args.organizationId),
  )
  .collect(); // Only checks relevant documents
```

### Authorization Errors

**Problem**: "User cannot access data they should have access to"

**Debug**: Check RLS rules in `rls-helpers.ts`

```typescript
// Add logging to debug RLS rules
read: async (rlsCtx, document) => {
  console.log('Checking read access:', {
    user: rlsCtx.user?.userId,
    documentOrg: document.organizationId,
    userOrgs: rlsCtx.userOrganizations?.map(o => o.organizationId),
  });

  if (!rlsCtx.user) return false;
  return userOrgIds.has(document.organizationId);
},
```

**Solution**: Ensure user is a member of the organization with correct role.

### Database Schema

**Required**: All business tables must have organization indexes

```typescript
// Add to convex/schema.ts
documents: defineTable({
  organizationId: v.id('organizations'),
  // ... other fields
}).index('by_organizationId', ['organizationId']),

products: defineTable({
  organizationId: v.id('organizations'),
  // ... other fields
}).index('by_organizationId', ['organizationId']),
```

### RLS Not Working

**Problem**: "RLS rules not being enforced"

**Checklist**:

1. ✅ Using `queryWithRLS`/`mutationWithRLS` instead of `query`/`mutation`
2. ✅ Table has rules defined in `rls-helpers.ts`
3. ✅ User is authenticated (check `getAuthUser()`)
4. ✅ User is member of organization (check membership table)

## Architecture

### File Structure

```
convex/
├── lib/
│   ├── rls-helpers.ts          # New: convex-helpers based RLS (USE THIS)
│   └── rls.ts                  # Old: manual validation (deprecated)
├── chat.ts                     # Uses queryWithRLS/mutationWithRLS
├── conversations.ts            # Uses queryWithRLS/mutationWithRLS
├── customers.ts                # Uses queryWithRLS/mutationWithRLS
└── ...
```

### Key Differences from Old Approach

| Aspect             | Old Approach (`rls.ts`)               | New Approach (`rls-helpers.ts`) |
| ------------------ | ------------------------------------- | ------------------------------- |
| **Validation**     | Manual `validateOrganizationAccess()` | Automatic via database wrapper  |
| **Location**       | Check at function start               | Check at database operation     |
| **Coverage**       | Easy to forget to validate            | Impossible to bypass            |
| **Performance**    | Validates upfront                     | Only validates accessed data    |
| **Complexity**     | Need to remember to call              | Just use `queryWithRLS`         |
| **Error Handling** | Manual throw statements               | Automatic permission errors     |

## Summary

**What you need**:

- ✅ `convex/lib/rls-helpers.ts` - Automatic RLS enforcement
- ✅ Organization indexes on all business tables
- ✅ Use `queryWithRLS` instead of `query`
- ✅ Use `mutationWithRLS` instead of `mutation`

**What you DON'T need**:

- ❌ Manual `validateOrganizationAccess()` calls
- ❌ Manual auth checks with `authComponent.getAuthUser()`
- ❌ Manual membership queries
- ❌ Complex wrapper functions

**Simple pattern**:

```typescript
import { queryWithRLS, mutationWithRLS } from './lib/rls-helpers';

// Queries - automatic filtering
export const listItems = queryWithRLS({
  args: { organizationId: v.id('organizations') },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query('items')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .collect();
  },
});

// Mutations - automatic validation
export const createItem = mutationWithRLS({
  args: { organizationId: v.id('organizations'), name: v.string() },
  returns: v.id('items'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('items', {
      organizationId: args.organizationId,
      name: args.name,
    });
  },
});
```

This gives you bulletproof Row Level Security with minimal code and zero boilerplate.

## Reference

- [Stack Article: Row Level Security](https://stack.convex.dev/row-level-security)
- [convex-helpers Documentation](https://github.com/get-convex/convex-helpers)
- Implementation: `convex/lib/rls-helpers.ts`
