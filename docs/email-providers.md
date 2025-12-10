# Email Providers – Convex Integration Guide

A single, concise guide for developers to understand and integrate the email providers feature using Convex. English-only. Follows Convex best practices.

## What you need to know

- Providers supported: Resend (fallback), SMTP (send), IMAP (receive), OAuth2 (Gmail, Microsoft), Password auth
- If both SMTP and IMAP are configured, both are validated and used
- Local dev uses Inbucket (see Local Development Setup section below)
- All data stored in Convex with proper encryption for secrets
- Uses Convex mutations for writes and queries for reads
- **Automatic default**: When creating the first email provider for an organization, it will automatically be set as the default provider, even if `isDefault: false` is specified

## Convex Schema

The `emailProviders` table is defined in `convex/schema.ts`:

```typescript
emailProviders: defineTable({
  organizationId: v.id('organizations'),
  name: v.string(),
  vendor: v.union(
    v.literal('gmail'),
    v.literal('outlook'),
    v.literal('smtp'),
    v.literal('resend'),
    v.literal('other'),
  ),
  authMethod: v.union(
    v.literal('password'),
    v.literal('oauth2'),
  ),

  // Auth configurations (encrypted in metadata)
  passwordAuth: v.optional(v.object({
    user: v.string(),
    passEncrypted: v.string(), // encrypted password
  })),

  oauth2Auth: v.optional(v.object({
    provider: v.string(), // 'gmail' | 'microsoft'
    clientId: v.string(),
    clientSecretEncrypted: v.string(), // encrypted secret
    accessTokenEncrypted: v.optional(v.string()),
    refreshTokenEncrypted: v.optional(v.string()),
    tokenExpiry: v.optional(v.number()),
  })),

  // SMTP configuration
  smtpConfig: v.optional(v.object({
    host: v.string(),
    port: v.number(),
    secure: v.boolean(),
  })),

  // IMAP configuration
  imapConfig: v.optional(v.object({
    host: v.string(),
    port: v.number(),
    secure: v.boolean(),
  })),

  // Status and metadata
  isActive: v.boolean(),
  isDefault: v.boolean(),
  status: v.optional(v.union(
    v.literal('active'),
    v.literal('error'),
    v.literal('testing'),
  )),
  lastTestedAt: v.optional(v.number()),
  lastSyncAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),

  metadata: v.optional(v.any()),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_vendor', ['organizationId', 'vendor'])
  .index('by_organizationId_and_isDefault', ['organizationId', 'isDefault'])
  .index('by_organizationId_and_status', ['organizationId', 'status']),
```

## UI flows (recommended)

1. Providers list page (simplified)

- Show table of providers (name, vendor, status, default, last tested)
- Buttons: Create, Set Default, Test, Edit, Delete

2. Create provider page (dedicated)

- Tabs are not required; use a single page with radio for Auth Method: Password or OAuth2
- Show vendor presets (Gmail/Outlook) to prefill hostnames/ports
- If OAuth2 + Microsoft (use existing login) is selected, we redirect to consent

3. Test provider action

- Call mutation to test; show SMTP and IMAP results separately

4. Receive email sync

- Manual "Sync now" triggers action; show results (processed/total/errors)

## Convex Functions (import paths)

All functions are in `convex/emailProviders.ts`:

### Queries

```typescript
import { api } from '@/convex/_generated/api';

// List all providers for an organization
api.emailProviders.list;

// Get single provider by ID
api.emailProviders.get;

// Get default provider for an organization
api.emailProviders.getDefault;
```

### Mutations

```typescript
// Update provider configuration
api.emailProviders.update;

// Delete provider
api.emailProviders.delete;

// Set provider as default
api.emailProviders.setDefault;
```

### Actions

```typescript
// Create email provider (password or OAuth2) - with encryption
api.emailProviders.create;

// Test SMTP/IMAP connectivity
api.emailProviders.test;

// Send email using provider
api.emailProviders.sendEmail;

// Sync received emails via IMAP
api.emailProviders.syncEmails;

// Initialize OAuth2 flow (returns auth URL)
api.emailProviders.initOAuth2;

// Handle OAuth2 callback
api.emailProviders.handleOAuth2Callback;
```

## Quick start – examples

### Using from React components

```typescript
'use client';

import { useQuery, useMutation, useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

function EmailProvidersPage({ organizationId }: { organizationId: Id<'organizations'> }) {
  // List providers
  const providers = useQuery(api.emailProviders.list, { organizationId });

  // Create provider action (handles encryption)
  const createProvider = useAction(api.emailProviders.create);

  // Handle create
  const handleCreate = async () => {
    await createProvider({
      organizationId,
      name: 'Gmail (App Password)',
      vendor: 'gmail',
      authMethod: 'password',
      passwordAuth: {
        user: 'you@gmail.com',
        pass: 'app-password' // will be encrypted
      },
      smtpConfig: { host: 'smtp.gmail.com', port: 587, secure: false },
      imapConfig: { host: 'imap.gmail.com', port: 993, secure: true },
      isActive: true,
      isDefault: true,
    });
  };

  return (
    <div>
      {providers?.map(provider => (
        <div key={provider._id}>{provider.name}</div>
      ))}
      <button onClick={handleCreate}>Create Provider</button>
    </div>
  );
}
```

### Create provider (Gmail + App Password)

```typescript
import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

const createProvider = useAction(api.emailProviders.create);

await createProvider({
  organizationId,
  name: 'Gmail (App Password)',
  vendor: 'gmail',
  authMethod: 'password',
  passwordAuth: {
    user: 'you@gmail.com',
    pass: 'app-password', // automatically encrypted by action
  },
  smtpConfig: { host: 'smtp.gmail.com', port: 587, secure: false },
  imapConfig: { host: 'imap.gmail.com', port: 993, secure: true },
  isActive: true,
  isDefault: true,
});
```

### Create provider (Gmail OAuth2)

```typescript
import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

const initOAuth2 = useAction(api.emailProviders.initOAuth2);

const authUrl = await initOAuth2({
  organizationId,
  name: 'Gmail OAuth2',
  vendor: 'gmail',
  authMethod: 'oauth2',
  oauth2Auth: {
    provider: 'gmail',
    clientId: 'your-client-id',
    clientSecret: 'your-secret', // will be encrypted
  },
  isActive: true,
  isDefault: true,
});

if (authUrl) {
  window.location.href = authUrl;
}
```

### Get default provider

```typescript
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';

const defaultProvider = useQuery(api.emailProviders.getDefault, {
  organizationId,
});
```

### Test provider

```typescript
import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

const testProvider = useAction(api.emailProviders.test);

const result = await testProvider({ providerId });
if (result.success) {
  console.log('SMTP:', result.smtp); // { success: true, latencyMs: 123 }
  console.log('IMAP:', result.imap); // { success: true, latencyMs: 45 }
}
```

### Send email

```typescript
import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

const sendEmail = useAction(api.emailProviders.sendEmail);

await sendEmail({
  organizationId,
  to: ['recipient@example.com'],
  subject: 'Hello',
  html: '<p>Hi</p>',
  // Optional: specify provider, otherwise uses default
  providerId: myProviderId,
});
```

### Sync received emails

```typescript
import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

const syncEmails = useAction(api.emailProviders.syncEmails);

const result = await syncEmails({
  organizationId,
  limit: 50,
});
console.log(`Synced ${result.processed} of ${result.total} emails`);
```

## OAuth2 Integration

### OAuth2 Flow

1. Call `api.emailProviders.initOAuth2` action to start the flow
2. User is redirected to provider consent screen
3. After consent, user is redirected back to `/api/auth/oauth2/callback`
4. Callback handler calls `api.emailProviders.handleOAuth2Callback` to complete setup
5. Tokens are encrypted and stored in the `emailProviders` table

### Redirect Configuration

- OAuth2 callback route: `/api/auth/oauth2/callback`
- Configure this exact URL in your OAuth2 provider console (Gmail/Microsoft)
- Ensure `SITE_URL` is set correctly in `.env` (or `DOMAIN` in Docker Compose)

### Required Environment Variables

```bash
# Base URL for OAuth2 callbacks (set via DOMAIN in Docker Compose)
SITE_URL=http://localhost:3000

# For Microsoft existing account flow (optional)
AUTH_MICROSOFT_ENTRA_ID_ID=your-client-id
AUTH_MICROSOFT_ENTRA_ID_SECRET=your-client-secret
AUTH_MICROSOFT_ENTRA_ID_ISSUER=https://login.microsoftonline.com/common/v2.0
```

### Scopes and Prerequisites

**Gmail**

- Scope: `https://mail.google.com/` (covers SMTP/IMAP/POP via XOAUTH2)
- You do NOT need `gmail.send` or `gmail.readonly` unless you call the Gmail REST API
- We request refresh tokens with `access_type=offline` and `prompt=consent`
- Enable IMAP in Gmail settings

**Microsoft 365 / Outlook**

- Scopes: `https://outlook.office.com/SMTP.Send`, `https://outlook.office.com/IMAP.AccessAsUser.All`, `offline_access`
- Ensure IMAP and SMTP AUTH are enabled in the tenant and for the mailbox in Exchange Online
- Choose tenant endpoint based on account type: consumers, organizations, or common

### OAuth2 Token Management

- Tokens are encrypted using Convex encryption utilities before storage
- Stored in the `oauth2Auth` field of the `emailProviders` table
- Automatic token refresh is handled by scheduled Convex cron jobs
- Token expiry is tracked in the `tokenExpiry` field (Unix timestamp)

### Implementation Details

**Convex Files**

- `convex/emailProviders.ts` – main queries, mutations, and actions
- `convex/lib/email-oauth2.ts` – OAuth2 utilities (token exchange, refresh, encryption)
- `convex/crons.ts` – scheduled token refresh job
- `app/api/auth/oauth2/callback/route.ts` – Next.js route handler for OAuth2 callbacks

**Token Refresh Strategy**

- Cron job runs every 30 minutes
- Checks for tokens expiring in the next hour
- Refreshes tokens proactively before expiry
- Updates `tokenExpiry` and `accessTokenEncrypted` fields

## Convex Best Practices for Email Providers

### Query Patterns

```typescript
// ✅ Good: Use indexed query for performance
const providers = await ctx.db
  .query('emailProviders')
  .withIndex('by_organizationId', (q) => q.eq('organizationId', organizationId))
  .filter((q) => q.eq(q.field('isActive'), true))
  .collect();

// ❌ Bad: Don't use filter without index
const providers = await ctx.db
  .query('emailProviders')
  .filter((q) => q.eq(q.field('organizationId'), organizationId))
  .collect();
```

### Mutation Patterns

```typescript
// ✅ Good: Validate and encrypt secrets
export const create = mutation({
  args: {
    organizationId: v.id('organizations'),
    name: v.string(),
    passwordAuth: v.optional(
      v.object({
        user: v.string(),
        pass: v.string(), // will be encrypted
      }),
    ),
    // ... other args
  },
  handler: async (ctx, args) => {
    // Encrypt password before storage
    const passEncrypted = args.passwordAuth?.pass
      ? await encrypt(args.passwordAuth.pass)
      : undefined;

    return await ctx.db.insert('emailProviders', {
      ...args,
      passwordAuth: passEncrypted
        ? {
            user: args.passwordAuth!.user,
            passEncrypted,
          }
        : undefined,
    });
  },
});
```

### Action Patterns

```typescript
// ✅ Good: Use actions for external API calls (SMTP/IMAP)
export const test = action({
  args: { providerId: v.id('emailProviders') },
  returns: v.object({
    success: v.boolean(),
    smtp: v.optional(
      v.object({
        success: v.boolean(),
        latencyMs: v.number(),
        error: v.optional(v.string()),
      }),
    ),
    imap: v.optional(
      v.object({
        success: v.boolean(),
        latencyMs: v.number(),
        error: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    // Get provider data via query
    const provider = await ctx.runQuery(internal.emailProviders.getInternal, {
      providerId: args.providerId,
    });

    // Test SMTP/IMAP connections (external API calls)
    const smtpResult = await testSmtpConnection(provider);
    const imapResult = await testImapConnection(provider);

    // Update provider status via mutation
    await ctx.runMutation(internal.emailProviders.updateStatus, {
      providerId: args.providerId,
      status: smtpResult.success && imapResult.success ? 'active' : 'error',
      lastTestedAt: Date.now(),
    });

    return {
      success: smtpResult.success && imapResult.success,
      smtp: smtpResult,
      imap: imapResult,
    };
  },
});
```

## Troubleshooting

### Common Issues

**Gmail password auth fails**

- Ensure App Passwords are enabled (requires 2FA)
- Consider migrating to OAuth2 for better security
- Verify IMAP is enabled in Gmail settings

**OAuth2 authorization errors**

- Verify scopes match exactly in provider console
- Ensure redirect URI matches exactly (including protocol and port)
- Check that `SITE_URL` is configured correctly (or `DOMAIN` in Docker Compose)

**Missing refresh tokens**

- Gmail: Ensure `access_type=offline` and `prompt=consent` are set
- Microsoft: Ensure `offline_access` scope is included

**SMTP/IMAP connection errors**

- Gmail: `smtp.gmail.com:587` (SMTP), `imap.gmail.com:993` (IMAP)
- Outlook: `smtp.office365.com:587` (SMTP), `outlook.office365.com:993` (IMAP)
- Verify firewall rules and network connectivity
- Check provider rate limits

**Slow SMTP performance**

- Increase connection/greeting/socket timeouts
- Consider connection pooling for high-volume scenarios

**TLS issues (development only)**

- For local dev, you may set `tls.rejectUnauthorized=false`
- NEVER use this in production

### Migration from Password to OAuth2

1. Create a new OAuth2 provider for the same mailbox
2. Complete OAuth2 consent flow
3. Test the new provider
4. Set new provider as default: `api.emailProviders.setDefault`
5. Deactivate the old password-based provider
6. Optionally delete the old provider after confirming the new one works

## UI Implementation Guidelines

### Provider List Component

```typescript
'use client';

import { useQuery, useMutation, useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export function EmailProvidersList({ organizationId }) {
  const providers = useQuery(api.emailProviders.list, { organizationId });
  const deleteProvider = useMutation(api.emailProviders.delete);
  const setDefault = useMutation(api.emailProviders.setDefault);
  const testProvider = useAction(api.emailProviders.test);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Vendor</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Default</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {providers?.map(provider => (
          <TableRow key={provider._id}>
            <TableCell>{provider.name}</TableCell>
            <TableCell>{provider.vendor}</TableCell>
            <TableCell>
              <Badge variant={provider.status === 'active' ? 'success' : 'destructive'}>
                {provider.status}
              </Badge>
            </TableCell>
            <TableCell>{provider.isDefault ? 'Yes' : 'No'}</TableCell>
            <TableCell>
              <Button onClick={() => testProvider({ providerId: provider._id })}>
                Test
              </Button>
              <Button onClick={() => setDefault({ providerId: provider._id })}>
                Set Default
              </Button>
              <Button onClick={() => deleteProvider({ providerId: provider._id })}>
                Delete
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

### Key UI Principles

- **Mask secrets**: Never render passwords or tokens in the UI
- **Show separate results**: Display SMTP and IMAP test results independently
- **Real-time updates**: Use Convex's reactive queries for live status updates
- **Error handling**: Show clear error messages for failed operations
- **Loading states**: Use Convex's loading states for better UX
- **Sync button**: Offer a "Sync now" button with result summary

## Local Development Setup

For local development, use Inbucket as a local SMTP server instead of real email services.

### Quick Setup

1. **Install Inbucket:**

```bash
# Using Docker (recommended)
docker run -d -p 9000:9000 -p 2500:2500 --name inbucket inbucket/inbucket

# Using Homebrew (macOS)
brew install inbucket && inbucket

# Using Go
go install github.com/inbucket/inbucket@latest && inbucket
```

2. **Create local provider:**

```typescript
import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

const createProvider = useAction(api.emailProviders.create);

await createProvider({
  organizationId,
  name: 'Local Dev (Inbucket)',
  vendor: 'smtp',
  authMethod: 'password',
  passwordAuth: {
    user: 'dev@local',
    pass: 'any', // Inbucket accepts any password (automatically encrypted by action)
  },
  smtpConfig: {
    host: 'localhost',
    port: 2500,
    secure: false,
  },
  isActive: true,
  isDefault: true,
});
```

3. **View emails:** Open http://localhost:9000

That's it! No special configuration needed - it's just another email provider pointing to localhost.

**Pro tip:** Use different Convex deployments for dev and production. Each deployment has its own `emailProviders` table, so your local Inbucket provider stays in dev only.

## Additional Resources

- [Convex Schema Documentation](https://docs.convex.dev/database/schemas)
- [Convex Queries and Mutations](https://docs.convex.dev/functions)
- [Convex Actions](https://docs.convex.dev/functions/actions)
- [Gmail OAuth2 Setup](https://developers.google.com/identity/protocols/oauth2)
- [Microsoft Graph OAuth2](https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow)
- [Inbucket Email Testing](https://www.inbucket.org/)
