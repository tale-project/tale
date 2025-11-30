# Workflow Database Operations

This directory contains specialized, safe database operations for workflows.

## Overview

All database operations for workflows are organized by table/entity type. Each entity has its own folder with specialized operations that follow Convex best practices.

## Available Operations

### 1. Customer Operations (`customers/`)

**Operations:**

- `createCustomer` - Create a new customer
- `queryCustomers` - Query customers with flexible filters
- `getCustomerById` - Get a single customer by ID
- `updateCustomers` - Update customer fields and metadata

**Features:**

- Uses `by_organizationId` and `by_organizationId_and_externalId` indexes
- Supports status and metadata filtering
- Safe nested metadata updates with lodash
- Requires organizationId or customerId to prevent bulk operations

**Documentation:** See `customers/README.md`

### 2. Conversation Operations (`conversations/`)

**Operations:**

- `createConversation` - Create a new conversation
- `queryConversations` - Query conversations with flexible filters
- `getConversationById` - Get a single conversation by ID
- `updateConversations` - Update conversation fields and metadata

**Features:**

- Uses `by_organizationId` index
- Supports status, priority, customerId, and metadata filtering
- Safe nested metadata updates with lodash
- Requires organizationId or conversationId to prevent bulk operations

### 3. Product Operations (`products/`)

**Operations:**

- `createProduct` - Create a new product
- `queryProducts` - Query products with flexible filters
- `getProductById` - Get a single product by ID
- `updateProducts` - Update product fields and metadata

**Features:**

- Uses `by_organizationId`, `by_organizationId_and_externalId`, `by_organizationId_and_status`, and `by_organizationId_and_category` indexes
- Supports status, category, externalId, and metadata filtering
- Safe nested metadata updates with lodash
- Requires organizationId or productId to prevent bulk operations

### 4. Document Operations (`documents/`)

**Operations:**

- `createDocument` - Create a new document
- `queryDocuments` - Query documents with flexible filters
- `getDocumentById` - Get a single document by ID
- `updateDocument` - Update a single document's fields and metadata (requires `documentId`)

**Features:**

- Uses `by_organizationId` and `by_organizationId_and_kind` indexes for queries
- Supports kind and metadata filtering when querying
- Safe nested metadata updates with lodash (metadata objects are deep-merged with existing metadata)
- Requires `documentId` for updates to prevent bulk operations
- For batch updates, iterate over document IDs and call `updateDocument` for each document

## Design Principles

### 1. One Function Per File

Each operation is in its own file with a matching name:

- **File name:** `snake_case` (e.g., `query_customers.ts`)
- **Function name:** `camelCase` (e.g., `queryCustomers`)

### 2. Use Convex Indexes

All queries use Convex indexes (`withIndex`) instead of dynamic filters:

```typescript
// ✅ Good: Uses index
const customers = await ctx.db
  .query('customers')
  .withIndex('by_organizationId', (q) =>
    q.eq('organizationId', args.organizationId),
  )
  .collect();

// ❌ Bad: Dynamic filter (removed)
const customers = await ctx.db
  .query('customers')
  .filter((q) => q.eq(q.field('organizationId'), args.organizationId))
  .collect();
```

### 3. Require Filters

All operations require either:

- A specific ID (customerId, productId, conversationId)
- An organizationId (to scope the query)

This prevents accidental bulk operations on all records.

### 4. Safe Nested Updates

All update operations use lodash for safe nested object handling:

```typescript
import { set, merge, get } from 'lodash';

// For dot-notation keys
set(metadata, 'churn.survey.sent', true);

// For object merging (preserves existing fields)
merge(existingMetadata, newMetadata);
```

### 5. Filter in Code is OK

Per [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/):

> "Filtering in code instead of using the .filter syntax has the same performance"

We use `withIndex` for organizationId (efficient), then filter in code for metadata. This is acceptable because:

1. We're already scoped to one organization (small result set)
2. Metadata fields are flexible and can't be indexed
3. The alternative would be a full table scan anyway

## Adding New Operations

To add operations for a new table:

### Step 1: Create Database Operations

1. Create a new folder: `convex/workflow/database/{table_name}/`
2. Create operation files following the naming convention
3. Create an `index.ts` to export all operations
4. Add exports to `executor.ts`

### Step 2: Create Action Definition

1. Create `convex/workflow/nodes/action/actions/{table_name}/{table_name}_action.ts`
2. Define the action with proper validators
3. Implement the `execute` method to call database operations
4. Register in `action_registry.ts`

### Step 3: Update Workflows

Replace `type: 'database'` with `type: '{table_name}'` in workflow examples.

## Migration from Generic Database Actions

The generic `database` action has been **completely removed** due to security issues:

- ❌ Empty filter could affect all records (data loss risk)
- ❌ Dynamic filter parsing was error-prone
- ❌ Didn't follow Convex best practices

All workflows have been migrated to use specialized actions.

## References

- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/)
- [Indexes and Query Performance](https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf)
- [Lodash Documentation](https://lodash.com/docs/)
- [Migration Guide](../nodes/action/actions/MIGRATION.md)
