---
description: Convex backend development standards and best practices
activationType: glob
patterns:
  - "**/convex/**/*.ts"
---

# Convex Standards

## Query Optimization
- CONSIDER TO preload queries with `preloadQuery` and `usePreloadedQuery` in React
- CONSIDER TO use rate limiting and action caching
- DO NOT use `.collect()`, use `const query = ...; for await (const ... of query)` instead

### ✅ Good - Async iteration
```typescript
const products = ctx.db.query("products");
for await (const product of products) {
  // process product
}
```

### ❌ Bad - Using collect()
```typescript
const products = await ctx.db.query("products").collect(); // Don't do this!
```

## Validation
- ALWAYS share validation schemas between client and server using Zod
- Validators are organized per domain in `lib/shared/validators/` (e.g., `members.ts`, `products.ts`)
- Import from `lib/shared/validators` on both client and server
- DO NOT duplicate validation logic

### Example
```typescript
// lib/shared/validators/products.ts
export const productSchema = z.object({
  name: z.string().min(1),
  price: z.number().positive(),
});

// convex/products.ts
import { productSchema } from "@/lib/shared/validators/products";

export const createProduct = mutation({
  args: { product: v.object(productSchema) },
  handler: async (ctx, args) => {
    // implementation
  },
});
```

## Data Architecture
- Backend functions should return raw data only
- All filtering, sorting, pagination happens on the client
- DO NOT keep deprecated functions - remove them entirely instead of marking with `@deprecated`
- AVOID conditional endpoint determination - use separate hardcoded fetch calls instead of if/else to determine endpoints dynamically

### ✅ Good - Separate endpoints
```typescript
// Separate, explicit queries
export const getActiveProducts = query({...});
export const getArchivedProducts = query({...});

// Client
const products = status === 'active' 
  ? useQuery(api.products.getActiveProducts)
  : useQuery(api.products.getArchivedProducts);
```

### ❌ Bad - Conditional endpoint
```typescript
// Don't determine endpoint dynamically
const endpoint = status === 'active' 
  ? api.products.getActiveProducts 
  : api.products.getArchivedProducts;
const products = useQuery(endpoint);
```
