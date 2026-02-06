/**
 * Conversation Auto-Archive Workflow
 *
 * This workflow automatically archives conversations that have been closed
 * for over a configurable number of days (default: 30 days).
 *
 * High-level flow:
 * 1) Find one closed conversation that has been resolved for over X days
 * 2) Update the conversation status to 'archived'
 * 3) Record the conversation as processed
 *
 * Key features:
 * - Uses smart index selection with filterExpression
 * - Configurable stale days threshold (default: 30)
 * - Processes one conversation per execution
 * - Prevents re-archiving with workflow_processing_records
 *
 * Use case:
 * Keep the conversations list clean by automatically archiving old closed
 * conversations, while preserving them for historical reference.
 */

import type { PredefinedWorkflowDefinition } from '../workflows/definitions/types';

const conversationAutoArchiveWorkflow: PredefinedWorkflowDefinition = {
  workflowConfig: {
    name: 'Conversation Auto-Archive',
    description:
      'Automatically archive conversations that have been closed for over 30 days',
    workflowType: 'predefined',
    version: '1.0.0',
    config: {
      timeout: 60000, // 1 minute timeout for single conversation
      retryPolicy: { maxRetries: 2, backoffMs: 3000 },
      variables: {
        organizationId: 'org_demo',
        workflowId: 'conversationAutoArchive',
        backoffHours: 168, // Only process conversations not processed in last 168 hours (7 days)
        staleDays: 30, // Archive conversations closed for over 30 days
      },
    },
  },
  stepsConfig: [
    // Step 1: Trigger - Scheduled daily at midnight
    {
      stepSlug: 'start',
      name: 'Start',
      stepType: 'start',
      order: 1,
      config: {
        type: 'manual', // Can be changed to 'schedule' for automated processing
        // For scheduled archiving, uncomment below:
        // schedule: '0 0 * * *', // Daily at midnight
        // timezone: 'UTC',
      },
      nextSteps: { success: 'find_stale_conversation' },
    },

    // Step 2: Find Stale Closed Conversation
    // Uses filterExpression with smart index selection
    {
      stepSlug: 'find_stale_conversation',
      name: 'Find Stale Closed Conversation',
      stepType: 'action',
      order: 2,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'find_unprocessed',
          tableName: 'conversations',
          backoffHours: '{{backoffHours}}',
          filterExpression:
            'status == "closed" && metadata.resolved_at && daysAgo(metadata.resolved_at) > {{staleDays}}',
        },
      },
      nextSteps: {
        success: 'check_has_conversation',
      },
    },

    // Step 3: Check if We Have a Conversation to Archive
    {
      stepSlug: 'check_has_conversation',
      name: 'Check Has Conversation',
      stepType: 'condition',
      order: 3,
      config: {
        expression: 'steps.find_stale_conversation.output.data != null',
        description: 'Check if a stale closed conversation was found',
      },
      nextSteps: {
        true: 'extract_conversation_data',
        false: 'noop',
      },
    },

    // Step 4: Extract Conversation Data
    {
      stepSlug: 'extract_conversation_data',
      name: 'Extract Conversation Data',
      stepType: 'action',
      order: 4,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'currentConversationId',
              value: '{{steps.find_stale_conversation.output.data._id}}',
            },
            {
              name: 'currentConversationSubject',
              value: '{{steps.find_stale_conversation.output.data.subject}}',
            },
            {
              name: 'resolvedAt',
              value:
                '{{steps.find_stale_conversation.output.data.metadata.resolved_at}}',
            },
          ],
        },
      },
      nextSteps: {
        success: 'archive_conversation',
      },
    },

    // Step 5: Archive the Conversation
    {
      stepSlug: 'archive_conversation',
      name: 'Archive Conversation',
      stepType: 'action',
      order: 5,
      config: {
        type: 'conversation',
        parameters: {
          operation: 'update',
          conversationId: '{{currentConversationId}}',
          updates: {
            status: 'archived',
          },
        },
      },
      nextSteps: {
        success: 'record_processed',
      },
    },

    // Step 6: Record Conversation as Processed
    {
      stepSlug: 'record_processed',
      name: 'Record Conversation as Processed',
      stepType: 'action',
      order: 6,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'record_processed',
          tableName: 'conversations',
          recordId: '{{currentConversationId}}',
          metadata: {
            action: 'archived',
            resolvedAt: '{{resolvedAt}}',
            archivedAt: '{{now}}',
            staleDays: '{{staleDays}}',
          },
        },
      },
      nextSteps: {
        success: 'noop',
      },
    },
  ],
};

export default conversationAutoArchiveWorkflow;
