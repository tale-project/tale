import type { PredefinedWorkflowDefinition } from '../workflows/definitions/types';

const generalCustomerStatusAssessmentWorkflow: PredefinedWorkflowDefinition = {
  workflowConfig: {
    name: 'General Customer Status Assessment',
    description:
      "Analyze a customer's status (active/churned/potential) using the full customer record and metadata",
    workflowType: 'predefined',
    version: '1.0.0',
    config: {
      timeout: 120000,
      retryPolicy: { maxRetries: 2, backoffMs: 1000 },
      variables: {
        organizationId: 'org_demo',
        workflowId: 'general-customer-status-assessment',
        backoffHours: 72,
      },
    },
  },
  stepsConfig: [
    {
      stepSlug: 'start',
      name: 'Start',
      stepType: 'start',
      order: 1,
      config: {},
      nextSteps: { success: 'find_unprocessed_customer' },
    },
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
      nextSteps: { success: 'check_has_customer' },
    },
    {
      stepSlug: 'check_has_customer',
      name: 'Check if Customer Found',
      stepType: 'condition',
      order: 3,
      config: {
        expression: 'steps.find_unprocessed_customer.output.data != null',
        description: 'Check if we found an unprocessed customer',
      },
      nextSteps: { true: 'extract_customer_data', false: 'noop' },
    },
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
            {
              name: 'currentCustomerStatus',
              value:
                '{{steps.find_unprocessed_customer.output.data.status}}',
            },
          ],
        },
      },
      nextSteps: { success: 'compose_prompts' },
    },
    {
      stepSlug: 'compose_prompts',
      name: 'Compose LLM Prompts',
      stepType: 'action',
      order: 5,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'llmSystemPrompt',
              value: `You are a Customer Status Analyzer for this business.

You receive the full customer record (all fields and metadata) as JSON.
Your job is to determine the customer's lifecycle status and explain your reasoning.

Possible statuses:
- "active": customer is currently engaged or has very recent activity, purchases, subscriptions, or interactions.
- "churned": customer was previously active but is now clearly inactive or has cancelled/ended their relationship.
- "potential": lead or prospect with little/no historical activity, or not enough evidence to treat them as active or churned yet.

Use ANY relevant signals in the customer record, for example:
- explicit status fields
- subscription or contract information in metadata
- order history, totalSpent, orderCount, last seen timestamps
- tags, segments, notes, or other metadata

If there is an existing valid status that clearly matches the evidence, you may keep it.
If the data is ambiguous, choose the most reasonable status and be conservative.

STRICT JSON RULES (CRITICAL):
- You MUST return ONLY a single JSON object.
- Do NOT include any natural language before or after the JSON.
- Do NOT wrap the JSON in markdown (no code fences).
- Do NOT say things like "Here is the JSON".
- The response MUST be directly parseable by JSON.parse.
- All keys MUST be in double quotes.
- Strings MUST use double quotes, never single quotes.
- Do NOT include comments inside the JSON.

You MUST return exactly this JSON shape:
{"status":"active"|"churned"|"potential","churnReason":string|null,"churnedAt":number|null}
`,
            },
            {
              name: 'llmUserPrompt',
              value: `Customer record (full JSON):
{{currentCustomer}}

Task:
Analyze this customer and determine their status ("active", "churned", or "potential")
using all available fields and metadata.

Return ONLY JSON in the exact shape described in the system prompt.`,
            },
          ],
        },
      },
      nextSteps: { success: 'analyze_status' },
    },
    {
      stepSlug: 'analyze_status',
      name: 'Analyze Customer Status',
      stepType: 'llm',
      order: 6,
      config: {
        name: 'General Customer Status Analyzer',
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
              type: 'string',
              nullable: true,
              description: 'Reason for churn if status is churned, otherwise null',
            },
            churnedAt: {
              type: 'number',
              nullable: true,
              description:
                'Timestamp when customer churned if status is churned, otherwise null',
            },
          },
          required: ['status', 'churnReason', 'churnedAt'],
          additionalProperties: false,
        },
        tools: ['rag_search'],
        systemPrompt: '{{llmSystemPrompt}}',
        userPrompt: '{{llmUserPrompt}}',
      },
      nextSteps: { success: 'update_customer_status' },
    },
    {
      stepSlug: 'update_customer_status',
      name: 'Update Customer Status',
      stepType: 'action',
      order: 7,
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
    {
      stepSlug: 'record_processed',
      name: 'Record Customer as Processed',
      stepType: 'action',
      order: 8,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'record_processed',
          tableName: 'customers',
          recordId: '{{currentCustomerId}}',
          metadata: {
            processedAt: '{{now}}',
            statusUpdated: true,
            previousStatus: '{{currentCustomerStatus}}',
            newStatus: '{{steps.analyze_status.output.data.status}}',
          },
        },
      },
      nextSteps: { success: 'noop' },
    },
  ],
};

export default generalCustomerStatusAssessmentWorkflow;
