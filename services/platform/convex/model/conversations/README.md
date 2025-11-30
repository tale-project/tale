# Conversations Model

## External Message ID

The `externalMessageId` field allows you to store and query conversations by their external message identifiers (e.g., email Message-ID headers). This field is now available on **both** the `conversations` and `conversationMessages` tables:

- **conversations.externalMessageId**: Stores the external message ID that created the conversation (e.g., the root email's Message-ID)
- **conversationMessages.externalMessageId**: Stores the external message ID for each individual message in the conversation

This is useful for:

- **Avoiding duplicates**: Check if a conversation already exists before creating a new one
- **Linking replies**: Find the parent conversation when processing email replies
- **Idempotent processing**: Safely re-process the same external message without creating duplicates

### Schema

```typescript
conversations: defineTable({
  organizationId: v.string(), // Better Auth organization ID
  customerId: v.optional(v.id('customers')),
  externalMessageId: v.optional(v.string()), // Root message ID that created this conversation
  subject: v.optional(v.string()),
  // ...other fields
}).index('by_organizationId_and_externalMessageId', [
  'organizationId',
  'externalMessageId',
]);

conversationMessages: defineTable({
  organizationId: v.string(), // Better Auth organization ID
  conversationId: v.id('conversations'),
  externalMessageId: v.optional(v.string()), // Message ID for this specific message
  // ...other fields
}).index('by_organizationId_and_externalMessageId', [
  'organizationId',
  'externalMessageId',
]);
```

### Usage Example

```typescript
import { internal } from './_generated/api';

// 1. Check if conversation already exists by external message ID
const existing = await ctx.runQuery(
  internal.conversations.getConversationByExternalMessageId,
  {
    organizationId: orgId,
    externalMessageId: emailMessageId,
  },
);

if (existing) {
  console.log('Conversation already exists:', existing._id);
  return existing._id;
}

// 2. Create new conversation with external message ID
const result = await ctx.runMutation(
  internal.conversations.createConversation,
  {
    organizationId: orgId,
    customerId: customerId,
    externalMessageId: emailMessageId, // Store the root email's Message-ID
    subject: emailSubject,
    status: 'open',
    priority: 'medium',
    metadata: {
      from: email.from,
      to: email.to,
      receivedAt: email.date,
    },
  },
);

console.log('Created conversation:', result.conversationId);
```

### Email Sync Example

```typescript
// When syncing emails, use externalMessageId to avoid duplicates
for (const email of emails) {
  const messageId = email.messageId; // e.g., "<abc123@mail.example.com>"

  // Check if we've already processed this email
  const existing = await ctx.runQuery(
    internal.conversations.getConversationByExternalMessageId,
    {
      organizationId: orgId,
      externalMessageId: messageId,
    },
  );

  if (existing) {
    console.log(`Skipping duplicate email: ${messageId}`);
    continue;
  }

  // Create new conversation for this email
  await ctx.runMutation(internal.conversations.createConversation, {
    organizationId: orgId,
    externalMessageId: messageId, // Store the email's Message-ID
    subject: email.subject,
    metadata: {
      from: email.from,
      to: email.to,
      body: email.text,
    },
  });
}
```

### API Reference

#### Internal Query: `getConversationByExternalMessageId`

```typescript
ctx.runQuery(internal.conversations.getConversationByExternalMessageId, {
  organizationId: Id<'organizations'>,
  externalMessageId: string,
});
// Returns: Doc<'conversations'> | null
```

#### Internal Query: `getMessageByExternalId`

```typescript
ctx.runQuery(internal.conversations.getMessageByExternalId, {
  organizationId: Id<'organizations'>,
  externalMessageId: string,
});
// Returns: Doc<'conversationMessages'> | null
```

#### Public Query: `getMessageByExternalIdPublic`

```typescript
ctx.runQuery(api.conversations.getMessageByExternalIdPublic, {
  organizationId: Id<'organizations'>,
  externalMessageId: string,
});
// Returns: Doc<'conversationMessages'> | null
// Note: Requires RLS authentication
```

#### Create conversation

```typescript
ctx.runMutation(internal.conversations.createConversation, {
  organizationId: Id<'organizations'>,
  externalMessageId: string, // Optional: Store the root external message ID
  // ... other fields
});
```

### Best Practices

1. **Always check for existing conversations** before creating new ones when processing external messages
2. **Use the full Message-ID** from email headers (including angle brackets if present)
3. Store the root external message ID on `conversations.externalMessageId` for conversation-level deduplication
4. Store individual message IDs on `conversationMessages.externalMessageId` for message-level tracking
5. Use the indexed queries (`getConversationByExternalMessageId` or `getMessageByExternalId`) instead of filtering by metadata
