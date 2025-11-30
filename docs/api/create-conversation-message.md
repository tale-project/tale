# Conversation API - Convex Functions

## Overview

This document describes the Convex functions available for managing conversations and messages. All functions can be called directly from client components using Convex React hooks or from server components using `fetchQuery`/`fetchMutation`.

## Mutations

### `createConversation`

Creates a new parent conversation.

**Parameters:**

```typescript
{
  organizationId: Id<'organizations'>;
  customerId?: Id<'customers'>;
  subject?: string;
  status?: string;  // Default: 'open'
  priority?: string;  // Default: 'medium'
  metadata?: any;
}
```

**Returns:** `Id<'conversations'>`

**Usage (Client):**

```typescript
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

const createConv = useMutation(api.conversations.createConversation);

await createConv({
  organizationId: orgId,
  customerId: custId,
  subject: 'Customer inquiry',
  status: 'open',
  priority: 'high',
});
```

---

### `addMessageToConversation`

Adds a message as a child conversation to an existing conversation.

**Parameters:**

```typescript
{
  conversationId: Id<'conversations'>;
  organizationId: Id<'organizations'>;
  sender: string;
  content: string;
  isCustomer: boolean;
  status?: string;  // Default: 'sent'
  attachment?: any;
}
```

**Returns:** `Id<'conversations'>` (message ID)

**Usage (Client):**

```typescript
const addMessage = useMutation(api.conversations.addMessageToConversation);

await addMessage({
  conversationId: convId,
  organizationId: orgId,
  sender: 'Agent Name',
  content: 'Thank you for contacting us...',
  isCustomer: false,
  status: 'sent',
});
```

---

### `closeConversation`

Closes a conversation.

**Parameters:**

```typescript
{
  conversationId: Id<'conversations'>;
  resolvedBy?: string;
}
```

**Returns:** `null`

---

### `reopenConversation`

Reopens a resolved conversation.

**Parameters:**

```typescript
{
  conversationId: Id<'conversations'>;
}
```

**Returns:** `null`

---

### `markConversationAsSpam`

Marks a conversation as spam.

**Parameters:**

```typescript
{
  conversationId: Id<'conversations'>;
}
```

**Returns:** `null`

---

### `markConversationAsRead`

Marks a conversation as read and resets unread count.

**Parameters:**

```typescript
{
  conversationId: Id<'conversations'>;
}
```

**Returns:** `null`

---

### `bulkCloseConversations`

Closes multiple conversations at once.

**Parameters:**

```typescript
{
  conversationIds: Id<'conversations'>[];
  resolvedBy?: string;
}
```

**Returns:**

```typescript
{
  successCount: number;
  failedCount: number;
}
```

---

### `bulkReopenConversations`

Reopens multiple conversations at once.

**Parameters:**

```typescript
{
  conversationIds: Id < 'conversations' > [];
}
```

**Returns:**

```typescript
{
  successCount: number;
  failedCount: number;
}
```

---

## Queries

### `getConversations`

Gets conversations for an organization with filtering and pagination.

**Parameters:**

```typescript
{
  organizationId: Id<'organizations'>;
  status?: string;
  priority?: string;
  search?: string;
  page?: number;  // Default: 1
  limit?: number;  // Default: 20
}
```

**Returns:**

```typescript
{
  conversations: Conversation[];  // Array of conversations with messages
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

**Usage (Client):**

```typescript
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';

const conversations = useQuery(api.conversations.getConversations, {
  organizationId: orgId,
  status: 'open',
  page: 1,
  limit: 20,
});
```

**Usage (Server):**

```typescript
import { fetchQuery } from 'convex/nextjs';
import { api } from '@/convex/_generated/api';

const conversations = await fetchQuery(api.conversations.getConversations, {
  organizationId: orgId,
  status: 'open',
});
```

---

### `getConversation`

Gets a single conversation by ID (without messages).

**Parameters:**

```typescript
{
  conversationId: Id<'conversations'>;
}
```

**Returns:** `Conversation | null`

---

### `getConversationWithMessages`

Gets a conversation with all its messages and customer data.

**Parameters:**

```typescript
{
  conversationId: Id<'conversations'>;
}
```

**Returns:** `ConversationWithMessages | null`

**Usage (Client):**

```typescript
const conversation = useQuery(api.conversations.getConversationWithMessages, {
  conversationId: convId,
});
```

---

## Data Model

### Conversation Structure

Conversations use a hierarchical model where:

- **Parent conversations** represent the main conversation thread
- **Child conversations** (where `parentId` is set) represent individual messages

### Key Fields

- `organizationId` - ID of the organization
- `customerId` - Optional customer ID
- `subject` - Conversation subject/title
- `status` - Status: 'pending', 'resolved', 'spam', 'archived'
- `priority` - Priority: 'low', 'medium', 'high'
- `parentId` - For child conversations (messages), references parent
- `metadata` - Flexible JSON field for additional data

### Metadata Fields (Parent Conversations)

```typescript
{
  description?: string;
  channel?: string;  // e.g., 'Email'
  category?: string;  // e.g., 'General', 'ProductRecommendation'
  unread_count?: number;
  last_message_at?: number;
  last_read_at?: string;
  resolved_at?: string;
  resolved_by?: string;
  marked_spam_at?: string;
}
```

### Metadata Fields (Child Conversations/Messages)

```typescript
{
  sender: string;
  content: string;
  isCustomer: boolean;
  attachment?: any;
}
```

---

## Best Practices

1. **Use `useMutation` for writes**: In client components, use the `useMutation` hook for all mutations.

2. **Use `useQuery` for reads**: In client components, use the `useQuery` hook for reactive queries.

3. **Use `fetchQuery`/`fetchMutation` in Server Components**: For Next.js server components or actions.

4. **Refresh after mutations**: Call `router.refresh()` after mutations in server-rendered pages to update the UI.

5. **Handle errors**: Always wrap mutations in try-catch blocks and provide user feedback.

6. **Batch operations**: Use bulk mutations when performing operations on multiple conversations.

## Example: Complete Conversation Flow

```typescript
'use client';

import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useRouter } from 'next/navigation';

export function ConversationComponent({ orgId, customerId }) {
  const router = useRouter();

  // Queries
  const conversations = useQuery(api.conversations.getConversations, {
    organizationId: orgId,
    status: 'open',
  });

  // Mutations
  const createConv = useMutation(api.conversations.createConversation);
  const addMessage = useMutation(api.conversations.addMessageToConversation);
  const close = useMutation(api.conversations.closeConversation);

  const handleCreateAndReply = async () => {
    try {
      // Create conversation
      const convId = await createConv({
        organizationId: orgId,
        customerId: customerId,
        subject: 'New inquiry',
      });

      // Add message
      await addMessage({
        conversationId: convId,
        organizationId: orgId,
        sender: 'Agent',
        content: 'Hello! How can we help?',
        isCustomer: false,
      });

      // Close after reply
      await close({ conversationId: convId });

      router.refresh();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  return (
    <div>
      <button onClick={handleCreateAndReply}>
        Create & Reply
      </button>
      {/* Render conversations */}
    </div>
  );
}
```
