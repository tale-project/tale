---
name: generate-auth-schema
description: Generate Better Auth schema for Convex.
---

# Generate Better Auth schema

Regenerate the Better Auth Convex schema file from the auth configuration. Run after changing anything under `services/platform/convex/betterAuth/auth.ts` or its imports.

## Usage

```bash
cd services/platform && npx @better-auth/cli generate -y --output convex/betterAuth/generated_schema.ts --config convex/betterAuth/auth.ts
```

## After generation

1. **Verify the output** — check that `convex/betterAuth/generated_schema.ts` was updated.
2. **Review the changes** — run `git diff services/platform/convex/betterAuth/generated_schema.ts` to see what changed.
3. **Report back** with a summary of any schema changes detected.
