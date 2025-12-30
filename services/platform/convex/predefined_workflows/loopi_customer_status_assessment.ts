/**
 * Customer Status Assessment - Predefined Workflow
 *
 * This workflow automatically finds and analyzes ONE customer that hasn't been
 * processed recently. It processes one customer per execution using the
 * workflow_processing_records system for efficient incremental processing.
 *
 * Comparison with Dynamic Orchestration Version:
 * - Predefined: Developer defines exact steps, agents, and flow (this file)
 * - Dynamic Orchestration: User provides goal/constraints, Plan Agent generates steps
 *
 * Workflow Flow:
 * 1. Trigger: Manual or scheduled execution
 * 2. Find Unprocessed Customer: Use workflow_processing_records to find one customer
 * 3. Check if Customer Found: Terminate gracefully if no customers to process
 * 4. Extract Customer Data: Store customer information in variables
 * 5. Analyze Status: Use LLM to determine customer status based on customer.metadata.subscriptions
 * 6. Update Customer Status: Update the customer record with determined status
 * 7. Record as Processed: Mark customer as processed to avoid reprocessing
 *
 * Status Determination Rules:
 * - If customer has NO subscriptions 												\u2192 status: "potential"
 * - If customer has at least ONE active subscription 							\u2192 status: "active"
 * - If customer has subscriptions but NONE are active 				\u2192 status: "churned"
 *
 * For churned customers, calculate churnedAt from the latest subscription end/cancellation date.
 *
 * Features:
 * - Processes one customer per execution (efficient and scalable)
 * - Uses workflow_processing_records for tracking processed customers
 * - Configurable backoff period (default: 72 hours / 3 days)
 * - AI-powered status analysis (GPT-4o)
 * - Graceful termination when no customers need processing
 */

export const loopiCustomerStatusAssessmentWorkflow = {
  workflowConfig: {
    name: 'Customer Status Assessment',
    description:
      'Automatically find and analyze one customer that needs status assessment using predefined steps',
    workflowType: 'predefined',
    version: '1.0.0',
    config: {
      timeout: 120000, // 2 minutes for single customer analysis
      retryPolicy: { maxRetries: 2, backoffMs: 1000 },
      variables: {
        organizationId: 'org_demo',
        workflowId: 'assess-customer-status',
        backoffHours: 72, // Only process customers not processed in last 72 hours (3 days)
      },
    },
  },
  stepsConfig: [
    // Step 1: Trigger - Manual or Scheduled
    {
      stepSlug: 'start',
      name: 'Start',
      stepType: 'trigger',
      order: 1,
      config: {
        type: 'manual', // Can be changed to 'schedule' for automated processing
        // For scheduled processing, uncomment below:
        // schedule: '*/5 * * * *', // Every 5 minutes
        // timezone: 'UTC',
      },
      nextSteps: { success: 'find_unprocessed_customer' },
    },

    // Step 2: Find One Unprocessed Customer
    {
      stepSlug: 'find_unprocessed_customer',
      name: 'Find One Unprocessed Customer',
      stepType: 'action',
      order: 2,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'find_unprocessed',
          tableName: 'customers',
          backoffHours: '{{backoffHours}}',
        },
      },
      nextSteps: {
        success: 'check_has_customer',
      },
    },

    // Step 3: Check if Customer Found
    {
      stepSlug: 'check_has_customer',
      name: 'Check if Customer Found',
      stepType: 'condition',
      order: 3,
      config: {
        expression: 'steps.find_unprocessed_customer.output.data != null',
        description: 'Check if we found an unprocessed customer',
      },
      nextSteps: {
        true: 'extract_customer_data',
        false: 'noop',
      },
    },

    // Step 4: Extract Customer Data
    {
      stepSlug: 'extract_customer_data',
      name: 'Extract Customer Data',
      stepType: 'action',
      order: 4,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'currentCustomer',
              value:
                '{{steps.find_unprocessed_customer.output.data}}',
            },
            {
              name: 'currentCustomerId',
              value:
                '{{steps.find_unprocessed_customer.output.data._id}}',
            },
            {
              name: 'currentCustomerName',
              value:
                '{{steps.find_unprocessed_customer.output.data.name}}',
            },
            {
              name: 'currentCustomerEmail',
              value:
                '{{steps.find_unprocessed_customer.output.data.email}}',
            },
          ],
        },
      },
      nextSteps: {
        success: 'analyze_status',
      },
    },

    // Step 6: Analyze Customer Status Based on Subscriptions
    {
      stepSlug: 'analyze_status',
      name: 'Analyze Customer Status',
      stepType: 'llm',
      order: 5,
      config: {
        llmNode: {
          name: 'Customer Status LLM',
          systemPrompt: `You are a Customer Status Analyzer specialized in determining customer status based on subscription data.

Your task is to analyze the subscription data and determine the customer's status according to these rules:

Status determination rules:
- If customer has NO subscriptions 								\u2192 status: "potential"
- If customer has at least ONE active subscription 			\u2192 status: "active"
- If customer has subscriptions but NONE are active 			\u2192 status: "churned"

For churned customers, you must also:
- Identify the latest subscription end date or cancellation date
- Calculate the churnedAt timestamp
- Provide a brief reason for the churn (e.g., "All subscriptions ended", "Subscription cancelled")

Available data:
- Customer ID: {{currentCustomerId}}
- Customer Name: {{currentCustomerName}}
- Customer Email: {{currentCustomerEmail}}
- Subscriptions: {{currentCustomer.metadata.subscriptions.data}}

Analyze the subscription data and provide your determination strictly as JSON with this exact shape:\n{"status":"active"|"churned"|"potential","churnReason":string|null,"churnedAt":number|null}\nReturn only the JSON, no extra text.`,
          userPrompt:
            'Analyze the subscription data and determine the customer status (active/churned/potential)',
          outputFormat: 'json',
          outputSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['active', 'churned', 'potential'],
                description: 'Customer lifecycle status',
              },
              churnReason: {
                type: ['string', 'null'],
                description:
                  'Reason for churn if status is churned, otherwise null',
              },
              churnedAt: {
                type: ['number', 'null'],
                description:
                  'Timestamp when customer churned if status is churned, otherwise null',
              },
            },
            required: ['status', 'churnReason', 'churnedAt'],
            additionalProperties: false,
          },
          temperature: 0.3,
          tools: ['rag_search'],
        },
      },
      nextSteps: { success: 'update_customer_status' },
    },

    // Step 7: Update Customer Status
    {
      stepSlug: 'update_customer_status',
      name: 'Update Customer Status',
      stepType: 'action',
      order: 6,
      config: {
        type: 'customer',
        parameters: {
          operation: 'update',
          customerId: '{{currentCustomerId}}',
          updates: {
            status: '{{steps.analyze_status.output.data.status}}',
            metadata: {
              statusAssessment: {
                churnReason: '{{steps.analyze_status.output.data.churnReason}}',
                churnedAt: '{{steps.analyze_status.output.data.churnedAt}}',
                assessedAt: '{{now}}',
              },
            },
          },
        },
      },
      nextSteps: { success: 'record_processed' },
    },

    // Step 8: Record Customer as Processed
    {
      stepSlug: 'record_processed',
      name: 'Record Customer as Processed',
      stepType: 'action',
      order: 7,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'record_processed',
          tableName: 'customers',
          recordId: '{{currentCustomerId}}',
          metadata: {
            processedAt: '{{now}}',
            statusUpdated: true,
          },
        },
      },
      nextSteps: {},
    },
  ],
};

export default loopiCustomerStatusAssessmentWorkflow;
