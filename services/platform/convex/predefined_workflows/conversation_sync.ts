/**
 * Conversation Sync Workflow (Generic)
 *
 * A generic workflow that syncs messages from any email/messaging integration
 * into conversations. Works with any integration that has `canSync: true` and
 * exposes `list_messages` + `get_thread` (or just `list_messages`) operations.
 *
 * Variables are overridden at provisioning time with integration-specific values:
 * - integrationName: The integration's name (e.g., "gmail", "outlook", "whatsapp")
 * - channel: The conversation channel (e.g., "email", "whatsapp", "sms")
 * - hasGetThread: Whether the integration supports `get_thread` operation
 * - accountEmail: The account email for direction detection (optional)
 *
 * High-level flow:
 * 1) Query the latest synced inbound message to get a cursor timestamp
 * 2) Fetch new messages from the integration since that timestamp
 * 3) If the integration supports threading, fetch the full thread
 * 4) Create/update conversations from the fetched messages
 */

import type { PredefinedWorkflowDefinition } from '../workflows/definitions/types';

const conversationSyncWorkflow: PredefinedWorkflowDefinition = {
  workflowConfig: {
    name: 'Conversation Sync',
    description:
      'Sync messages from an integration into conversations with automatic thread grouping',
    version: '1.0.0',
    workflowType: 'predefined',
    config: {
      timeout: 300000, // 5 minutes
      retryPolicy: { maxRetries: 3, backoffMs: 2000 },
      variables: {
        organizationId: '',
        integrationName: '',
        channel: 'email',
        conversationStatus: 'open',
        hasGetThread: true,
        accountEmail: '',
      },
    },
  },

  stepsConfig: [
    // Step 1: Start trigger (scheduled or manual)
    {
      stepSlug: 'start',
      name: 'Start',
      stepType: 'start',
      order: 1,
      config: {},
      nextSteps: { success: 'query_latest_inbound_message' },
    },

    // Step 2: Query latest synced inbound message as cursor
    {
      stepSlug: 'query_latest_inbound_message',
      name: 'Query Latest Synced Message',
      stepType: 'action',
      order: 2,
      config: {
        type: 'conversation',
        parameters: {
          operation: 'query_latest_message_by_delivery_state',
          channel: '{{channel}}',
          direction: 'inbound',
          deliveryState: 'delivered',
          integrationName: '{{integrationName}}',
        },
      },
      nextSteps: { success: 'check_has_cursor' },
    },

    // Step 3: Check if we have a cursor (previously synced message)
    {
      stepSlug: 'check_has_cursor',
      name: 'Check Has Cursor',
      stepType: 'condition',
      order: 3,
      config: {
        expression:
          'steps.query_latest_inbound_message.output.data.message != null',
        description:
          'Check if we have a previously synced message to use as cursor',
      },
      nextSteps: {
        true: 'fetch_new_messages',
        false: 'fetch_latest_message',
      },
    },

    // Step 4a: Fetch latest message (first run, no cursor)
    {
      stepSlug: 'fetch_latest_message',
      name: 'Fetch Latest Message (First Run)',
      stepType: 'action',
      order: 4,
      config: {
        type: 'integration',
        parameters: {
          name: '{{integrationName}}',
          operation: 'list_messages',
          params: {
            maxResults: 1,
          },
        },
      },
      nextSteps: { success: 'check_has_messages' },
    },

    // Step 4b: Fetch new messages since last sync (incremental)
    {
      stepSlug: 'fetch_new_messages',
      name: 'Fetch New Messages (Incremental)',
      stepType: 'action',
      order: 5,
      config: {
        type: 'integration',
        parameters: {
          name: '{{integrationName}}',
          operation: 'list_messages',
          params: {
            after:
              '{{steps.query_latest_inbound_message.output.data.message.deliveredAt|epochSeconds}}',
            maxResults: 1,
          },
        },
      },
      nextSteps: { success: 'check_has_messages' },
    },

    // Step 5: Check if any messages were fetched
    {
      stepSlug: 'check_has_messages',
      name: 'Check Has Messages',
      stepType: 'condition',
      order: 6,
      config: {
        expression:
          '(steps.fetch_new_messages.output.data.result.data|length > 0) || (steps.fetch_latest_message.output.data.result.data|length > 0)',
        description: 'Check if any messages were fetched from either path',
      },
      nextSteps: {
        true: 'check_has_threading',
        false: 'noop',
      },
    },

    // Step 6: Check if integration supports threading
    {
      stepSlug: 'check_has_threading',
      name: 'Check Threading Support',
      stepType: 'condition',
      order: 7,
      config: {
        expression: 'hasGetThread == true',
        description:
          'Check if the integration supports get_thread for full conversation threading',
      },
      nextSteps: {
        true: 'extract_thread_id',
        false: 'insert_messages_to_conversation',
      },
    },

    // Step 7a: Extract thread ID from fetched message
    {
      stepSlug: 'extract_thread_id',
      name: 'Extract Thread ID',
      stepType: 'action',
      order: 8,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'threadId',
              value:
                '{{(steps.fetch_new_messages.output.data.result.data|first || steps.fetch_latest_message.output.data.result.data|first).threadId}}',
            },
          ],
        },
      },
      nextSteps: { success: 'fetch_thread_messages' },
    },

    // Step 7b: Fetch full thread messages
    {
      stepSlug: 'fetch_thread_messages',
      name: 'Fetch Thread Messages',
      stepType: 'action',
      order: 9,
      config: {
        type: 'integration',
        parameters: {
          name: '{{integrationName}}',
          operation: 'get_thread',
          params: {
            threadId: '{{threadId}}',
            format: 'email',
          },
        },
      },
      nextSteps: { success: 'insert_threaded_to_conversation' },
    },

    // Step 8a: Insert threaded messages into conversation
    {
      stepSlug: 'insert_threaded_to_conversation',
      name: 'Create Conversation from Thread',
      stepType: 'action',
      order: 10,
      config: {
        type: 'conversation',
        parameters: {
          operation: 'create_from_email',
          emails: '{{steps.fetch_thread_messages.output.data.result.data}}',
          status: '{{conversationStatus}}',
          integrationName: '{{integrationName}}',
          accountEmail: '{{accountEmail}}',
        },
      },
      nextSteps: { success: 'noop' },
    },

    // Step 8b: Insert non-threaded messages into conversation (no get_thread)
    {
      stepSlug: 'insert_messages_to_conversation',
      name: 'Create Conversation from Messages',
      stepType: 'action',
      order: 11,
      config: {
        type: 'conversation',
        parameters: {
          operation: 'create_from_email',
          emails:
            '{{steps.fetch_new_messages.output.data.result.data || steps.fetch_latest_message.output.data.result.data}}',
          status: '{{conversationStatus}}',
          integrationName: '{{integrationName}}',
          accountEmail: '{{accountEmail}}',
        },
      },
      nextSteps: { success: 'noop' },
    },
  ],
};

export default conversationSyncWorkflow;
