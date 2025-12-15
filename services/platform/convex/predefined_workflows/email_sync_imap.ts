/**
 * Email Sync via IMAP Workflow
 *
 * This workflow syncs emails from an IMAP email provider into conversations.
 * It fetches emails and automatically detects and fetches complete email threads.
 *
 * Features:
 * - Manual trigger (can be changed to scheduled)
 * - Supports both password-based and OAuth2 authentication
 * - Automatic OAuth2 token refresh when needed
 * - Incremental sync (only fetches new emails after last synced UID)
 * - Automatic customer creation from email senders
 * - Duplicate detection using externalMessageId
 * - Full email threading support (In-Reply-To and References headers)
 * - Automatically fetches all messages in a thread when threading headers detected
 * - Creates conversation + conversationMessages for proper thread representation
 * - Tracks last synced UID for efficient incremental updates
 * - Processes 1 email per execution (if threaded, fetches entire thread automatically)
 */

// =============================================================================
// WORKFLOW DEFINITION (CONFIG + STEPS)
// =============================================================================

export const emailSyncImapWorkflow = {
  workflowConfig: {
    name: 'Email Sync (IMAP)',
    description:
      'Sync emails from IMAP provider with automatic thread detection and full conversation history',
    version: '2.0.0',
    workflowType: 'predefined', // Predefined workflow - developer-defined, user provides credentials
    config: {
      timeout: 300000, // 5 minutes
      retryPolicy: { maxRetries: 3, backoffMs: 2000 },
      variables: {
        organizationId: '', // Set by user
        imapHost: '', // Will be set from default email provider
        imapPort: 993, // Will be set from default email provider
        imapSecure: true, // Will be set from default email provider
        imapUsername: '', // Will be set from default email provider

        conversationStatus: 'open', // Default status for created conversations
        // afterUid: omit to fetch latest email, or set to a UID to fetch the email after it
      },
      secrets: {
        // imapPassword will be set dynamically during workflow execution
        // from the email provider's decrypted password
      },
    },
  },
  stepsConfig: [
    // Step 1: Trigger - Manual
    {
      stepSlug: 'start',
      name: 'start',
      stepType: 'trigger',
      order: 1,
      config: {
        type: 'manual',
        // For scheduled sync, change to:
        // type: 'scheduled',
        // schedule: '*/15 * * * *', // Every 15 minutes
        // timezone: 'UTC',
      },
      nextSteps: { success: 'get_imap_credentials' },
    },

    // Step 2: Get IMAP Credentials (handles both password and OAuth2)
    {
      stepSlug: 'get_imap_credentials',
      name: 'Get IMAP Credentials',
      stepType: 'action',
      order: 2,
      config: {
        type: 'email_provider',
        parameters: {
          operation: 'get_imap_credentials',
        },
      },
      nextSteps: {
        success: 'set_imap_credentials',
      },
    },

    // Step 3: Set IMAP Credentials from Provider
    {
      stepSlug: 'set_imap_credentials',
      name: 'Set IMAP Credentials',
      stepType: 'action',
      order: 3,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'providerId',
              value: '{{steps.get_imap_credentials.output.data.providerId}}',
            },
            {
              name: 'imapHost',
              value:
                '{{steps.get_imap_credentials.output.data.credentials.host}}',
            },
            {
              name: 'imapPort',
              value:
                '{{steps.get_imap_credentials.output.data.credentials.port}}',
            },
            {
              name: 'imapSecure',
              value:
                '{{steps.get_imap_credentials.output.data.credentials.secure}}',
            },
            {
              name: 'imapUsername',
              value:
                '{{steps.get_imap_credentials.output.data.credentials.username}}',
            },
            {
              name: 'imapPassword',
              value:
                '{{steps.get_imap_credentials.output.data.credentials.passwordEncrypted}}',
              secure: true, // Encrypted; engine decrypts just-in-time (password auth)
            },
            {
              name: 'imapAccessToken',
              value:
                '{{steps.get_imap_credentials.output.data.credentials.accessTokenEncrypted}}',
              secure: true, // Encrypted; engine decrypts just-in-time (OAuth2 auth)
            },
          ],
        },
      },
      nextSteps: {
        success: 'query_latest_inbound_message',
      },
    },

    // Step 4: Query Latest Inbound Message
    {
      stepSlug: 'query_latest_inbound_message',
      name: 'Query Latest Inbound Message',
      stepType: 'action',
      order: 4,
      config: {
        type: 'conversation',
        parameters: {
          operation: 'query_latest_message_by_delivery_state',
          channel: 'email',
          direction: 'inbound',
          deliveryState: 'delivered',
          providerId: '{{providerId}}',
        },
      },
      nextSteps: {
        success: 'set_last_uid',
      },
    },

    // Step 5: Set Last UID Variable
    {
      stepSlug: 'set_last_uid',
      name: 'Set Last UID Variable',
      stepType: 'action',
      order: 5,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'afterUid',
              value:
                '{{steps.query_latest_inbound_message.output.data.message ? steps.query_latest_inbound_message.output.data.message.metadata.uid : null}}',
            },
          ],
        },
      },
      nextSteps: {
        success: 'fetch_emails',
      },
    },

    // Step 6: Fetch Emails from IMAP (with thread support, supports both password and OAuth2)
    {
      stepSlug: 'fetch_emails',
      name: 'Fetch Emails from IMAP',
      stepType: 'action',
      order: 6,
      config: {
        type: 'imap',
        parameters: {
          // Credentials from workflow variables (set from email provider)
          // Note: Either imapPassword or imapAccessToken will be set depending on auth method
          host: '{{imapHost}}',
          port: '{{imapPort}}',
          secure: '{{imapSecure}}',
          username: '{{imapUsername}}',
          password: '{{secrets.imapPassword}}', // For password auth
          accessToken: '{{secrets.imapAccessToken}}', // For OAuth2 auth
          // Operation details
          operation: 'search',

          afterUid: '{{afterUid}}', // Use UID from last synced conversation
          includeAttachments: false,
          parseHtml: true,
        },
      },
      nextSteps: {
        success: 'check_has_emails',
      },
    },

    // Step 7: Check if we got any emails
    {
      stepSlug: 'check_has_emails',
      name: 'Check Has Emails',
      stepType: 'condition',
      order: 7,
      config: {
        expression: 'steps.fetch_emails.output.data|length > 0',
        description: 'Check if any emails were fetched',
      },
      nextSteps: {
        true: 'insert_email_to_conversation',
        false: 'noop', // No emails, stop
      },
    },

    // Step 8: Insert Emails to Conversation (with thread support)
    {
      stepSlug: 'insert_email_to_conversation',
      name: 'Insert Emails to Conversation',
      stepType: 'action',
      order: 8,
      config: {
        type: 'conversation',
        parameters: {
          operation: 'create_from_email',
          emails: '{{steps.fetch_emails.output.data}}', // All fetched emails (including thread messages)
          status: '{{conversationStatus}}', // Configurable status
          providerId: '{{providerId}}', // Email provider ID
        },
      },
      nextSteps: {
        success: 'noop', // Done
      },
    },
  ],
};

export default emailSyncImapWorkflow;
