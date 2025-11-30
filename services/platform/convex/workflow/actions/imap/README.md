# IMAP Email Retrieval Action

This action allows you to retrieve emails from any IMAP-compatible email server (Gmail, Outlook, Yahoo, etc.) within your workflows.

## Features

- **Multiple Operations**: List, search, or get specific emails
- **Flexible Authentication**: Support for standard IMAP credentials
- **Advanced Search**: Filter emails by sender, recipient, subject, date, flags, etc.
- **Attachment Support**: Optionally include attachment metadata
- **HTML Parsing**: Optionally parse HTML content
- **Mark as Read**: Optionally mark retrieved emails as seen
- **Pagination**: Support for offset and limit to handle large mailboxes

## Configuration

### Credentials

You can provide IMAP credentials in two ways:

1. **In action parameters** (for testing or single-use):

```typescript
{
  type: 'imap',
  config: {
    parameters: {
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      username: 'user@gmail.com',
      password: 'app-password',
      operation: 'list',
    },
  },
}
```

2. **In workflow variables** (recommended for reusable workflows):

```typescript
{
  workflowConfig: {
    config: {
      variables: {
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        imapSecure: true,
        imapUsername: 'user@gmail.com',
        imapPassword: 'app-password',
      },
    },
  },
}
```

### Common IMAP Servers

| Provider           | Host                  | Port | Secure |
| ------------------ | --------------------- | ---- | ------ |
| Gmail              | imap.gmail.com        | 993  | true   |
| Outlook/Office 365 | outlook.office365.com | 993  | true   |
| Yahoo              | imap.mail.yahoo.com   | 993  | true   |
| iCloud             | imap.mail.me.com      | 993  | true   |

**Note for Gmail**: You need to use an [App Password](https://support.google.com/accounts/answer/185833) instead of your regular password.

## Operations

### 1. List Emails

Retrieve the most recent emails from a mailbox:

```typescript
{
  type: 'imap',
  config: {
    parameters: {
      operation: 'list',
      mailbox: 'INBOX', // Optional, defaults to 'INBOX'
      limit: 50, // Optional, defaults to 50
      offset: 0, // Optional, defaults to 0
      markAsSeen: false, // Optional, defaults to false
      includeAttachments: true, // Optional, defaults to false
      parseHtml: true, // Optional, defaults to false
    },
  },
}
```

### 2. Search Emails

Search for emails matching specific criteria:

```typescript
{
  type: 'imap',
  config: {
    parameters: {
      operation: 'search',
      searchCriteria: {
        from: 'sender@example.com', // Optional
        to: 'recipient@example.com', // Optional
        subject: 'Invoice', // Optional
        since: '2024-01-01', // Optional, ISO date string
        before: '2024-12-31', // Optional, ISO date string
        unseen: true, // Optional, only unread emails
        flagged: false, // Optional
      },
      limit: 100,
      markAsSeen: false,
      includeAttachments: true,
    },
  },
}
```

### 3. Get Specific Email

Retrieve a specific email by UID:

```typescript
{
  type: 'imap',
  config: {
    parameters: {
      operation: 'get',
      uid: 12345, // Required for 'get' operation
      markAsSeen: true,
      includeAttachments: true,
      parseHtml: true,
    },
  },
}
```

## Response Format

The action returns an object with the following structure:

```typescript
{
  success: true,
  operation: 'list' | 'search' | 'get',
  mailbox: 'INBOX',
  messages: [
    {
      uid: 12345,
      messageId: '<unique-message-id@example.com>',
      from: [{ name: 'John Doe', address: 'john@example.com' }],
      to: [{ name: 'Jane Smith', address: 'jane@example.com' }],
      cc: [{ name: 'Bob', address: 'bob@example.com' }], // Optional
      bcc: [], // Optional
      subject: 'Important Email',
      date: '2024-01-15T10:30:00.000Z',
      text: 'Plain text content...',
      html: '<html>...</html>', // Only if parseHtml: true
      attachments: [ // Only if includeAttachments: true
        {
          filename: 'document.pdf',
          contentType: 'application/pdf',
          size: 102400,
        },
      ],
      flags: ['\\Seen', '\\Flagged'],
      headers: { // Optional
        'x-custom-header': 'value',
      },
    },
  ],
  count: 1,
  duration: 1234, // milliseconds
  timestamp: 1705315800000,
}
```

## Example Workflows

### Example 1: Process Unread Emails

```typescript
{
  workflowConfig: {
    name: 'Process Unread Emails',
    workflowType: 'predefined',
    config: {
      variables: {
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        imapSecure: true,
        imapUsername: 'support@company.com',
        imapPassword: '${secrets.GMAIL_APP_PASSWORD}',
      },
    },
  },
  steps: [
    {
      id: 'trigger',
      type: 'trigger',
      config: { type: 'manual' },
    },
    {
      id: 'fetch_unread',
      type: 'action',
      config: {
        type: 'imap',
        parameters: {
          operation: 'search',
          searchCriteria: {
            unseen: true,
          },
          limit: 20,
          markAsSeen: true,
          includeAttachments: true,
        },
      },
    },
    {
      id: 'process_emails',
      type: 'loop',
      config: {
        items: '${fetch_unread.messages}',
        itemVariable: 'email',
      },
    },
    // ... process each email
  ],
}
```

### Example 2: Search for Invoices

```typescript
{
  id: 'search_invoices',
  type: 'action',
  config: {
    type: 'imap',
    parameters: {
      operation: 'search',
      searchCriteria: {
        from: 'billing@vendor.com',
        subject: 'Invoice',
        since: '2024-01-01',
        unseen: true,
      },
      limit: 50,
      includeAttachments: true,
    },
  },
}
```

## Error Handling

The action will throw an error if:

- IMAP credentials are missing or invalid
- Connection to the IMAP server fails
- The specified mailbox doesn't exist
- Required parameters are missing (e.g., `uid` for 'get' operation)
- Search criteria are missing for 'search' operation

## Security Best Practices

1. **Use App Passwords**: For Gmail and other providers, use app-specific passwords instead of your main account password
2. **Store Credentials Securely**: Use workflow secrets for passwords: `${secrets.IMAP_PASSWORD}`
3. **Limit Access**: Use dedicated email accounts for automation with minimal permissions
4. **Enable 2FA**: Enable two-factor authentication on your email account
5. **Monitor Usage**: Regularly review which workflows have access to email credentials

## Performance Considerations

- **Limit Results**: Use the `limit` parameter to avoid retrieving too many emails at once
- **Use Search**: Use the `search` operation with specific criteria instead of listing all emails
- **Pagination**: Use `offset` and `limit` for pagination when processing large mailboxes
- **Mark as Seen**: Consider using `markAsSeen: true` to avoid processing the same emails multiple times
- **Timeout**: Adjust the `timeout` parameter if you're experiencing connection issues (default: 30000ms)

## Troubleshooting

### Connection Timeout

- Increase the `timeout` parameter
- Check your network connectivity
- Verify the IMAP server address and port

### Authentication Failed

- Verify your username and password
- For Gmail, ensure you're using an App Password
- Check if IMAP is enabled in your email account settings

### No Emails Returned

- Verify the mailbox name (case-sensitive)
- Check your search criteria
- Ensure there are emails matching your criteria

## File Structure

```
imap/
├── imap_action.ts              # Main action definition
├── types.ts                    # TypeScript interfaces
├── get_imap_credentials.ts     # Credential helper
├── retrieve_imap_emails.ts     # IMAP client implementation
└── README.md                   # This file
```
