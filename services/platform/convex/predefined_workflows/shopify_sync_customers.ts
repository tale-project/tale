/**
 * Shopify Customers Sync Workflow (with Pagination Support)
 *
 * This workflow synchronizes ALL customers from Shopify to the local database.
 * It fetches customers from Shopify API with pagination support, processes and validates the data,
 * then stores it in the customers table with proper deduplication.
 *
 * Features:
 * - Supports pagination to fetch all customers (not just first page)
 * - Uses Shopify's cursor-based pagination (page_info)
 * - Configurable page size and max pages limit
 * - Tracks progress across multiple pages
 * - Uses unified integration action (credentials + plugin execution in one step)
 */

const shopifySyncCustomersWorkflow = {
  workflowConfig: {
    name: 'Shopify Customers Sync',
    description:
      'Synchronize customers from Shopify to local database with pagination',
    version: '3.0.0',
    workflowType: 'predefined', // Predefined workflow - developer-defined, user provides credentials
    config: {
      timeout: 300000, // 5 minutes for full sync
      retryPolicy: { maxRetries: 3, backoffMs: 2000 },
      variables: {
        pageSize: 50, // Fetch 50 customers per page (Shopify max is 250)
        maxPages: 20, // Safety limit to prevent infinite loops
        currentPage: 0, // Track current page number
        nextPageInfo: null, // Cursor for next page (managed automatically)
      },
    },
  },
  stepsConfig: [
    // Step 1: Trigger - Manual or Scheduled
    {
      stepSlug: 'trigger_start',
      name: 'Start Customers Sync',
      stepType: 'start',
      order: 1,
      config: {},
      nextSteps: { success: 'fetch_customers' },
    },

    // Step 2: Fetch Customers from Shopify (unified integration action)
    // This single step handles: loading credentials + executing plugin
    {
      stepSlug: 'fetch_customers',
      name: 'Fetch Customers from Shopify',
      stepType: 'action',
      order: 2,
      config: {
        type: 'integration',
        parameters: {
          name: 'shopify',
          operation: 'list_customers',
          params: {
            limit: '{{pageSize}}', // Use configurable page size
            page_info: '{{nextPageInfo}}', // Cursor for pagination (null for first page)
          },
        },
      },
      nextSteps: {
        success: 'loop_customers',
      },
    },

    // Step 3: Loop Through Customers (automatically handles empty arrays)
    {
      stepSlug: 'loop_customers',
      name: 'Loop Through Customers',
      stepType: 'loop',
      order: 3,
      config: {
        // Integration action returns: { result: { data: [...], pagination: {...} } }
        items: '{{steps.fetch_customers.output.data.result.data}}',
        itemVariable: 'customer',
      },
      nextSteps: {
        loop: 'query_existing_customer',
        done: 'check_has_next_page',
      },
    },

    // Step 4: Query if Customer Already Exists
    {
      stepSlug: 'query_existing_customer',
      name: 'Query Existing Customer',
      stepType: 'action',
      order: 4,
      config: {
        type: 'customer',
        parameters: {
          operation: 'query',
          externalId: '{{loop.item.id}}',
          paginationOpts: {
            numItems: 1,
            cursor: null,
          },
        },
      },
      nextSteps: {
        success: 'check_customer_exists',
      },
    },

    // Step 5: Check if Customer Exists
    {
      stepSlug: 'check_customer_exists',
      name: 'Check Customer Exists',
      stepType: 'condition',
      order: 5,
      config: {
        expression:
          'steps.query_existing_customer.output.data.items|length > 0',
        description: 'Check if customer already exists in database',
      },
      nextSteps: {
        true: 'update_existing_customer',
        false: 'insert_new_customer',
      },
    },

    // Step 6: Update Existing Customer
    {
      stepSlug: 'update_existing_customer',
      name: 'Update Existing Customer',
      stepType: 'action',
      order: 6,
      config: {
        type: 'customer',
        parameters: {
          operation: 'update',
          customerId:
            '{{steps.query_existing_customer.output.data.items[0]._id}}',
          updates: {
            name: '{{loop.item.first_name}} {{loop.item.last_name}}',
            email: '{{loop.item.email}}',
            metadata: {
              shopify: '{{loop.item}}',
              syncedAt: '{{now}}',
            },
          },
        },
      },
      nextSteps: {
        success: 'loop_customers', // Continue to next customer
      },
    },

    // Step 7: Insert New Customer
    {
      stepSlug: 'insert_new_customer',
      name: 'Insert New Customer',
      stepType: 'action',
      order: 7,
      config: {
        type: 'customer',
        parameters: {
          operation: 'create',
          name: '{{loop.item.first_name}} {{loop.item.last_name}}',
          email: '{{loop.item.email}}',
          externalId: '{{loop.item.id}}',
          source: 'shopify',
          metadata: {
            shopify: '{{loop.item}}',
            syncedAt: '{{now}}',
          },
        },
      },
      nextSteps: {
        success: 'loop_customers', // Continue to next customer
      },
    },

    // Step 8: Check if There's a Next Page (with page limit check)
    {
      stepSlug: 'check_has_next_page',
      name: 'Check Has Next Page',
      stepType: 'condition',
      order: 8,
      config: {
        expression:
          'steps.fetch_customers.output.data.result.pagination.hasNextPage == true && currentPage < maxPages',
        description:
          'Check if Shopify has more pages and we have not exceeded max page limit',
      },
      nextSteps: {
        true: 'prepare_next_page',
        false: 'noop',
      },
    },

    // Step 9: Prepare Next Page (increment counter and update cursor)
    {
      stepSlug: 'prepare_next_page',
      name: 'Prepare Next Page',
      stepType: 'action',
      order: 9,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'currentPage',
              value: '{{currentPage + 1}}',
            },
            {
              name: 'nextPageInfo',
              value:
                '{{steps.fetch_customers.output.data.result.pagination.nextPageInfo}}',
            },
          ],
        },
      },
      nextSteps: {
        success: 'fetch_customers', // Loop back to fetch next page
      },
    },
  ],
};

export default shopifySyncCustomersWorkflow;
