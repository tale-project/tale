Generate Better Auth schema for Convex.

## Instructions

Run the Better Auth CLI to regenerate the schema file:

```bash
cd services/platform && npx @better-auth/cli generate -y --output convex/betterAuth/generated_schema.ts --config convex/betterAuth/auth.ts
```

After generation:

1. **Verify the output** - check that `convex/betterAuth/generated_schema.ts` was updated
2. **Review the changes** - run `git diff services/platform/convex/betterAuth/generated_schema.ts` to see what changed
3. **Report back** with a summary of any schema changes detected
