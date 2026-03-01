---
description: TypeScript coding standards and type safety rules
activationType: glob
patterns:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript Standards

## Type Safety
- USE implicit typing whenever possible
- DO NOT use type casting (`as`) - use type guards, generics, or proper type narrowing instead
- The only exception is framework-generated code or unavoidable third-party library limitations (document with a comment explaining why)
- DO NOT use `any` or `unknown` unless absolutely unavoidable
- Prefer proper types, generics, or `never`

## Import/Export Organization
- ALWAYS put imports at the top and exports at the bottom
- Keep them sorted correctly
- PREFER named exports - AVOID default exports (only if needed)
- AVOID index barrel files as much as possible
- PREFER `export const/let`, `export function`, `export class` etc. instead of `export { ... }`
- PREFER `export * from` instead of `export { ... } from`
- DO NOT export if not needed outside the module

## Examples

### ✅ Good - Named exports with implicit typing
```typescript
export const calculateTotal = (items: Item[]) => {
  return items.reduce((sum, item) => sum + item.price, 0);
};

export function processOrder(order: Order) {
  // implementation
}
```

### ❌ Bad - Default export with type casting
```typescript
export default function processOrder(order: any) {
  const typedOrder = order as Order; // Avoid this!
  // implementation
}
```
