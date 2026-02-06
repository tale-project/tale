/**
 * Sent Email Sync via IMAP Workflow
 *
 * This workflow syncs sent emails from an IMAP email provider into conversations.
 * It fetches sent emails from the "Sent" mailbox and creates outbound conversations
 * with proper deduplication and threading.
 *
 * Features:
 * - Manual trigger (can be changed to scheduled)
 * - Incremental sync (only fetches new sent emails)
 * - Automatic mailbox detection (Gmail: "[Gmail]/Sent Mail", Outlook: "Sent Items")
 * - Automatic customer creation from email recipients
 * - Duplicate detection using externalMessageId
 * - Email threading support (In-Reply-To header)
 * - Tracks last synced UID for efficient incremental updates
 */

// =============================================================================
// WORKFLOW DEFINITION (CONFIG + STEPS)
// =============================================================================

const emailSyncSentImapWorkflow = {
  workflowConfig: {
    name: 'Sent Email Sync (IMAP)',
    description:
      'Sync sent emails from IMAP provider into conversations with deduplication and threading',
    version: '1.0.0',
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
        mailbox: 'Sent', // Default Sent folder name (will be auto-detected based on provider)
        conversationStatus: 'open', // Default status for created conversations (valid values: 'open', 'closed', 'spam', 'archived')
        // afterUid: omit to fetch latest emails, or set to a UID to fetch emails after it
      },
      secrets: {
        // imapPassword / imapAccessToken will be set dynamically during workflow execution
        // from the email provider's encrypted credentials (decrypted just-in-time)
      },
    },
  },
  stepsConfig: [
    // Step 1: Trigger - Manual
    {
      stepSlug: 'start',
      name: 'start',
      stepType: 'start',
      order: 1,
      config: {
        type: 'manual',
        // For scheduled sync, change to:
        // type: 'scheduled',
        // schedule: '*/15 * * * *', // Every 15 minutes
        // timezone: 'UTC',
      },
      nextSteps: { success: 'get_default_email_provider' },
    },

    // Step 2: Get Default Email Provider
    {
      stepSlug: 'get_default_email_provider',
      name: 'Get Default Email Provider',
      stepType: 'action',
      order: 2,
      config: {
        type: 'email_provider',
        parameters: {
          operation: 'get_default',
        },
      },
      nextSteps: {
        success: 'get_imap_credentials',
      },
    },

    // Step 3: Get IMAP Credentials (handles password and OAuth2)
    {
      stepSlug: 'get_imap_credentials',
      name: 'Get IMAP Credentials',
      stepType: 'action',
      order: 3,
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
    {
      stepSlug: 'set_imap_credentials',
      name: 'Set IMAP Credentials from Provider',
      stepType: 'action',
      order: 4,
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
              secure: true,
            },
            {
              name: 'imapAccessToken',
              value:
                '{{steps.get_imap_credentials.output.data.credentials.accessTokenEncrypted}}',
              secure: true,
            },
            {
              name: 'mailbox',
              value:
                '{{steps.get_default_email_provider.output.data.vendor == "gmail" ? "[Gmail]/Sent Mail" : (steps.get_default_email_provider.output.data.vendor == "outlook" ? "Sent Items" : "Sent")}}',
            },
          ],
        },
      },
      nextSteps: {
        success: 'query_latest_outbound_message',
      },
    },

    // Step 5: Query Latest Outbound Message
    {
      stepSlug: 'query_latest_outbound_message',
      name: 'Query Latest Outbound Message',
      stepType: 'action',
      order: 5,
      config: {
        type: 'conversation',
        parameters: {
          operation: 'query_latest_message_by_delivery_state',
          channel: 'email',
          direction: 'outbound',
          deliveryState: 'delivered',
          providerId: '{{providerId}}',
        },
      },
      nextSteps: {
        success: 'set_last_uid',
      },
    },

    // Step 6: Set Last UID Variable
    {
      stepSlug: 'set_last_uid',
      name: 'Set Last UID Variable',
      stepType: 'action',
      order: 6,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'afterUid',
              value:
                '{{lastOutput && lastOutput.data && lastOutput.data.message && lastOutput.data.message.metadata ? lastOutput.data.message.metadata.uid : null}}',
            },
          ],
        },
      },
      nextSteps: {
        success: 'fetch_emails',
      },
    },

    // Step 7: Fetch Single Sent Email from IMAP
    {
      stepSlug: 'fetch_emails',
      name: 'Fetch Sent Email from IMAP',
      stepType: 'action',
      order: 7,
      config: {
        type: 'imap',
        parameters: {
          // Credentials from workflow variables (set from default email provider)
          host: '{{imapHost}}',
          port: '{{imapPort}}',
          secure: '{{imapSecure}}',
          username: '{{imapUsername}}',
          password: '{{secrets.imapPassword}}', // Password stored as secret for security
          accessToken: '{{secrets.imapAccessToken}}', // OAuth2 access token (if set)
          // Operation details
          operation: 'search',
          mailbox: '{{mailbox}}', // Sent folder (configured based on provider vendor)
          afterUid: '{{afterUid}}', // Use UID from last synced conversation
          includeAttachments: false,
          parseHtml: true,
        },
      },
      nextSteps: {
        success: 'check_has_emails',
      },
    },

    // Step 8: Check if we got any emails
    {
      stepSlug: 'check_has_emails',
      name: 'Check Has Emails',
      stepType: 'condition',
      order: 8,
      config: {
        expression: 'steps.fetch_emails.output.data|length > 0',
        description: 'Check if any emails were fetched',
      },
      nextSteps: {
        true: 'insert_sent_email_to_conversation',
        false: 'noop', // No emails, stop
      },
    },

    // Step 9: Insert Sent Email to Conversation
    {
      stepSlug: 'insert_sent_email_to_conversation',
      name: 'Insert Sent Email to Conversation',
      stepType: 'action',
      order: 9,
      config: {
        type: 'conversation',
        parameters: {
          operation: 'create_from_sent_email',
          emails: '{{steps.fetch_emails.output.data}}', // All fetched emails
          status: '{{conversationStatus}}', // Configurable status
          accountEmail: '{{imapUsername}}',
          providerId: '{{providerId}}', // Email provider ID
        },
      },
      nextSteps: {
        success: 'noop', // Done
      },
    },
  ],
};

export default emailSyncSentImapWorkflow;
