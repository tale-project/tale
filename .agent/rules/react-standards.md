---
description: React and TanStack Start development standards
activationType: glob
patterns:
  - "**/*.tsx"
  - "**/app/**/*.ts"
  - "**/components/**/*.ts"
---

# React & TanStack Start Standards

## Component Development
- CONSIDER ALWAYS to use reusable components
- USE `useMemo`, `useCallback` and `memo` at the right moment (don't overuse)
- DO NOT overuse `useEffect`
- USE the custom `Image` component from `@/components/ui/image` for all images
- USE TanStack Router for navigation with `useNavigate()` and `Link` components

## Storybook
- ALWAYS add Storybook stories for new UI components in `components/ui/`
- Stories should demonstrate all variants, sizes, and key states
- Example: `button.stories.tsx` should show primary/secondary variants, all sizes, disabled state, loading state, etc.

## Styling with CVA
- ALWAYS USE `cva` for named variants (e.g., `size: 'sm' | 'md' | 'lg'`, `variant: 'primary' | 'secondary'`)
- DO NOT use `cva` for boolean states (e.g., `isActive`, `error`, `muted`)
- For boolean conditions, use conditional `cn()` patterns instead

### ✅ Good - CVA for variants, cn() for booleans
```typescript
const buttonVariants = cva('base-button', {
  variants: {
    variant: {
      primary: 'bg-primary text-white',
      secondary: 'bg-secondary text-gray-900',
    },
    size: {
      sm: 'px-2 py-1 text-sm',
      md: 'px-4 py-2 text-base',
      lg: 'px-6 py-3 text-lg',
    },
  },
});

// In component
<button className={cn(
  buttonVariants({ variant, size }),
  isActive && 'ring-2 ring-blue-500',
  error && 'border-red-500'
)} />
```

### ❌ Bad - CVA for boolean states
```typescript
const buttonVariants = cva('base-button', {
  variants: {
    isActive: { true: 'ring-2', false: '' }, // Don't do this!
    error: { true: 'border-red', false: '' }, // Don't do this!
  },
});
```

## Project Structure
- **`/app`**: Route-specific code (pages, layouts, and subfolders like `components/`, `hooks/`, `actions/`, `utils/` scoped to that route)
- **`/components`, `/hooks`, `/actions`, `/utils`** (root): Shared/reusable code across multiple routes

## Translations
- Do NOT hardcode text - use the translation hooks/functions instead for user-facing UI
- All user-facing strings should be translatable
