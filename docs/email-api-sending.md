# Email API Sending (Gmail API & Microsoft Graph)

This document explains how to use API-based email sending instead of SMTP to avoid port blocking issues on cloud providers like DigitalOcean.

## Overview

The system now supports two methods for sending emails:

1. **SMTP** - Traditional email sending via SMTP protocol (ports 25, 465, 587)
2. **API** - Modern API-based sending via Gmail API or Microsoft Graph API (HTTPS only)

## Why Use API Sending?

- ✅ **No port blocking** - Uses HTTPS (port 443) which is never blocked
- ✅ **Better for cloud providers** - Works on DigitalOcean, AWS, etc. without special configuration
- ✅ **No DNS setup needed** - When sending from Gmail/Outlook accounts (e.g., `support@gmail.com`, `larry.luo@tale.dev`)
- ✅ **Full threading support** - Maintains email conversations with `In-Reply-To` and `References` headers
- ✅ **Message ID tracking** - Returns Internet Message ID for tracking and threading
- ✅ **OAuth2 security** - Uses secure OAuth2 tokens instead of passwords

## How It Works

### Architecture

```
Email Provider (with sendMethod: 'api')
    ↓
send_message_via_email.ts (checks sendMethod)
    ↓
sendMessageViaAPIInternal (routes to correct API)
    ↓
Gmail API or Microsoft Graph API
    ↓
Returns Internet Message ID for threading
```

### Supported Providers

| Provider | API | OAuth2 Required | DNS Setup Required |
|----------|-----|-----------------|-------------------|
| Gmail | Gmail API | Yes | No (if sending from @gmail.com) |
| Outlook/Microsoft 365 | Microsoft Graph API | Yes | No (if domain already on M365) |

## Setup Instructions

### 1. Create Email Provider with API Sending

When creating an email provider, set `sendMethod: 'api'`:

```typescript
import { api } from '@/convex/_generated/api';

// Create Gmail provider with API sending
const providerId = await ctx.runAction(api.email_providers.createOAuth2Provider, {
  organizationId: 'your-org-id',
  name: 'Gmail API',
  vendor: 'gmail',
  sendMethod: 'api',  // ← Use API instead of SMTP
  oauth2Auth: {
    provider: 'gmail',
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
    authorizationCode: 'auth-code-from-oauth-flow',
  },
  // No smtpConfig needed for API sending!
  imapConfig: {
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
  },
});
```

```typescript
// Create Outlook/Microsoft 365 provider with API sending
const providerId = await ctx.runAction(api.email_providers.createOAuth2Provider, {
  organizationId: 'your-org-id',
  name: 'Outlook API',
  vendor: 'outlook',
  sendMethod: 'api',  // ← Use API instead of SMTP
  oauth2Auth: {
    provider: 'microsoft',
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
    authorizationCode: 'auth-code-from-oauth-flow',
    accountType: 'organizational',  // or 'personal'
  },
  // No smtpConfig needed for API sending!
  imapConfig: {
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
  },
});
```

### 2. OAuth2 Scopes Required

**Gmail:**
- `https://mail.google.com/` - Full Gmail access (send + read)

**Microsoft:**
- `https://graph.microsoft.com/Mail.Send` - Send emails
- `https://outlook.office.com/IMAP.AccessAsUser.All` - IMAP access (for receiving)
- `https://graph.microsoft.com/User.Read` - Get user info
- `offline_access` - Refresh tokens

### 3. Sending Emails

Once configured, sending works exactly the same as before:

```typescript
import { api } from '@/convex/_generated/api';

// Send email (automatically uses API if sendMethod is 'api')
await ctx.runMutation(api.conversations.sendMessage, {
  conversationId: 'conversation-id',
  organizationId: 'your-org-id',
  content: 'Email body',
  to: ['recipient@example.com'],
  subject: 'Hello from API',
  html: '<p>Email body</p>',
  // Threading headers work the same
  inReplyTo: '<previous-message-id@domain.com>',
  references: ['<msg1@domain.com>', '<msg2@domain.com>'],
});
```

## Features

### ✅ Message ID Tracking

Both Gmail API and Microsoft Graph API return the Internet Message ID:

```typescript
// After sending, the message is updated with:
{
  externalMessageId: '<abc123@gmail.com>',  // Internet Message ID
  deliveryState: 'sent',
  sentAt: 1234567890,
}
```

### ✅ Email Threading

Threading works exactly like SMTP:

```typescript
// Reply to an existing email
await ctx.runMutation(api.conversations.sendMessage, {
  conversationId: 'conversation-id',
  organizationId: 'your-org-id',
  content: 'Reply message',
  to: ['recipient@example.com'],
  subject: 'Re: Original Subject',
  html: '<p>Reply message</p>',
  inReplyTo: '<original-message-id@domain.com>',
  references: ['<msg1@domain.com>', '<original-message-id@domain.com>'],
});
```

### ✅ HTML and Plain Text

Both content types are supported:

```typescript
await ctx.runMutation(api.conversations.sendMessage, {
  // ... other fields
  html: '<h1>Hello</h1><p>This is HTML</p>',
  text: 'Hello\n\nThis is plain text',
});
```

### ✅ CC, BCC, Reply-To

All standard email fields work:

```typescript
await ctx.runMutation(api.conversations.sendMessage, {
  // ... other fields
  to: ['recipient@example.com'],
  cc: ['cc@example.com'],
  bcc: ['bcc@example.com'],
  replyTo: 'reply-to@example.com',
});
```

## Migration from SMTP to API

### Option 1: Update Existing Provider

```typescript
// Update an existing provider to use API
await ctx.runMutation(api.email_providers.update, {
  providerId: 'existing-provider-id',
  sendMethod: 'api',  // Switch from SMTP to API
  // Remove smtpConfig if no longer needed
  smtpConfig: undefined,
});
```

### Option 2: Create New Provider

Create a new provider with `sendMethod: 'api'` and set it as default.

## Troubleshooting

### Error: "API sending requires OAuth2 authentication"

**Solution:** API sending only works with OAuth2. Password authentication is not supported for API sending.

### Error: "Unsupported provider for API sending"

**Solution:** Only Gmail and Microsoft providers support API sending. For other providers, use SMTP.

### Error: "Gmail API error: 401 Unauthorized"

**Solution:** OAuth2 token expired. The system should automatically refresh it. If not, re-authorize the provider.

### Error: "Microsoft Graph API error: 403 Forbidden"

**Solution:** Check that the OAuth2 app has the required scopes (`Mail.Send`).

## Comparison: SMTP vs API

| Feature | SMTP | API |
|---------|------|-----|
| **Port blocking** | ❌ Often blocked | ✅ Never blocked (HTTPS) |
| **DNS setup** | ⚠️ Required for custom domains | ✅ Not needed for Gmail/M365 |
| **OAuth2 support** | ✅ Yes (XOAUTH2) | ✅ Yes (native) |
| **Password auth** | ✅ Yes | ❌ No |
| **Threading** | ✅ Yes | ✅ Yes |
| **Message ID** | ✅ Yes | ✅ Yes |
| **Attachments** | ✅ Yes | ⚠️ Not yet implemented |
| **Rate limits** | ⚠️ Provider-specific | ✅ Higher limits |

## Best Practices

1. **Use API for cloud deployments** - Avoid port blocking issues
2. **Use SMTP for on-premise** - If you control the network
3. **Keep OAuth2 tokens fresh** - System handles this automatically
4. **Monitor token expiry** - Check provider status regularly
5. **Test before production** - Send test emails to verify configuration

## Example: Complete Setup

```typescript
// 1. Create OAuth2 provider with API sending
const providerId = await ctx.runAction(api.email_providers.createOAuth2Provider, {
  organizationId: 'org-123',
  name: 'Company Outlook',
  vendor: 'outlook',
  sendMethod: 'api',
  oauth2Auth: {
    provider: 'microsoft',
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    authorizationCode: authCode,
    accountType: 'organizational',
  },
  imapConfig: {
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
  },
});

// 2. Send email (automatically uses API)
const messageId = await ctx.runMutation(api.conversations.sendMessage, {
  conversationId: conversationId,
  organizationId: 'org-123',
  providerId: providerId,
  content: 'Hello from API!',
  to: ['customer@example.com'],
  subject: 'Welcome',
  html: '<h1>Welcome!</h1><p>Thanks for signing up.</p>',
});

// 3. Message is sent via Microsoft Graph API
// 4. Internet Message ID is stored for threading
```

## Next Steps

- [ ] Add attachment support for API sending
- [ ] Add delivery status tracking via webhooks
- [ ] Add read receipt support
- [ ] Add batch sending optimization

