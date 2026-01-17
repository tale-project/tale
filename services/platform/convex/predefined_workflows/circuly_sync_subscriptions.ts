/**
 * Circuly Subscriptions Sync Workflow (with Pagination Support)
 *
 * This workflow synchronizes subscription data from Circuly to customer metadata.
 * It fetches all customers with source='circuly' using pagination, then for each customer:
 * 1. Queries their subscriptions from Circuly API using customer's externalId
 * 2. Updates the customer's metadata.subscriptions field with the fetched data
 *
 * Features:
 * - Supports pagination to process all Circuly customers (not just first page)
 * - Uses cursor-based pagination for efficient data fetching
 * - Fetches subscriptions for each customer from Circuly API
 * - Updates customer metadata with subscription information
 * - Secure credential management using encrypted secrets
 * - Continues processing even if individual customer sync fails
 * - Automatically fetches next page until all customers are processed
 */

const circulySyncSubscriptionsWorkflow = {
  workflowConfig: {
    name: 'Circuly Subscriptions Sync',
    description:
      'Synchronize subscription data from Circuly to customer metadata with pagination',
    version: '2.0.0',
    workflowType: 'predefined', // Predefined workflow - developer-defined, user provides credentials
    config: {
      timeout: 600000, // 10 minutes for full sync
      retryPolicy: { maxRetries: 3, backoffMs: 2000 },
      variables: {
        organizationId: 'org_demo',
        pageSize: 50, // Fetch 50 customers per page
        currentCursor: null, // Track current pagination cursor
        totalProcessed: 0, // Track total customers processed
      },
    },
  },
  stepsConfig: [
    // Step 1: Trigger - Manual or Scheduled
    {
      stepSlug: 'start',
      name: 'start',
      stepType: 'trigger',
      order: 1,
      config: {
        type: 'manual', // Can be changed to 'schedule' for automated sync
        // For scheduled sync, uncomment below:
        // schedule: '0 3 * * *', // Daily at 3 AM
        // timezone: 'UTC',
      },
      nextSteps: { success: 'fetch_circuly_customers' },
    },

    // Step 2: Fetch Circuly Customers from Database (with pagination)
    {
      stepSlug: 'fetch_circuly_customers',
      name: 'Fetch Circuly Customers',
      stepType: 'action',
      order: 4,
      config: {
        type: 'customer',
        parameters: {
          operation: 'query',
          source: 'circuly',
          paginationOpts: {
            numItems: '{{pageSize}}',
            cursor: '{{currentCursor}}',
          },
        },
      },
      nextSteps: {
        success: 'check_customers_found',
      },
    },

    // Step 3: Check if Any Customers Were Found
    {
      stepSlug: 'check_customers_found',
      name: 'Check Customers Found',
      stepType: 'condition',
      order: 5,
      config: {
        expression: 'steps.fetch_circuly_customers.output.data.items|length > 0',
        description: 'Check if any Circuly customers exist in current page',
      },
      nextSteps: {
        true: 'loop_customers',
        false: 'noop',
      },
    },

    // Step 4: Loop Through Customers
    {
      stepSlug: 'loop_customers',
      name: 'Loop Through Customers',
      stepType: 'loop',
      order: 6,
      config: {
        items: '{{steps.fetch_circuly_customers.output.data.items}}',
        itemVariable: 'customer',
      },
      nextSteps: {
        loop: 'check_has_external_id',
        done: 'check_has_more_pages',
      },
    },

    // Step 5: Check if Customer Has External ID
    {
      stepSlug: 'check_has_external_id',
      name: 'Check Has External ID',
      stepType: 'condition',
      order: 7,
      config: {
        expression:
          'loop.item.externalId != null && loop.item.externalId != ""',
        description: 'Check if customer has a valid Circuly external ID',
      },
      nextSteps: {
        true: 'fetch_customer_subscriptions',
        false: 'loop_customers', // Skip customers without external ID
      },
    },

    // Step 6: Fetch Subscriptions for Customer from Circuly
    {
      stepSlug: 'fetch_customer_subscriptions',
      name: 'Fetch Customer Subscriptions',
      stepType: 'action',
      order: 8,
      config: {
        type: 'integration',
        parameters: {
          name: 'circuly',
          operation: 'list_subscriptions',
          params: {
            customer_id: '{{loop.item.externalId}}',
            per_page: 100, // Fetch up to 100 subscriptions per customer
          },
        },
      },
      nextSteps: {
        success: 'update_customer_subscriptions',
      },
    },

    // Step 7: Update Customer Metadata with Subscriptions
    {
      stepSlug: 'update_customer_subscriptions',
      name: 'Update Customer Subscriptions',
      stepType: 'action',
      order: 9,
      config: {
        type: 'customer',
        parameters: {
          operation: 'update',
          customerId: '{{loop.item._id}}',
          updates: {
            metadata: {
              subscriptions:
                '{{steps.fetch_customer_subscriptions.output.data}}',
              subscriptionsSyncedAt: '{{now}}',
            },
          },
        },
      },
      nextSteps: {
        success: 'loop_customers', // Continue to next customer
      },
    },

    // Step 10: Check if There Are More Pages
    {
      stepSlug: 'check_has_more_pages',
      name: 'Check Has More Pages',
      stepType: 'condition',
      order: 12,
      config: {
        expression: 'steps.fetch_circuly_customers.output.data.isDone == false',
        description: 'Check if there are more pages of customers to process',
      },
      nextSteps: {
        true: 'update_cursor_and_fetch_next',
        false: 'noop',
      },
    },

    // Step 11: Update Cursor and Fetch Next Page
    {
      stepSlug: 'update_cursor_and_fetch_next',
      name: 'Update Cursor and Fetch Next Page',
      stepType: 'action',
      order: 13,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'currentCursor',
              value:
                '{{steps.fetch_circuly_customers.output.data.continueCursor}}',
            },
            {
              name: 'totalProcessed',
              value:
                '{{totalProcessed + steps.fetch_circuly_customers.output.data.items|length}}',
            },
          ],
        },
      },
      nextSteps: {
        default: 'fetch_circuly_customers', // Fetch next page
      },
    },
  ],
};

export default circulySyncSubscriptionsWorkflow;
