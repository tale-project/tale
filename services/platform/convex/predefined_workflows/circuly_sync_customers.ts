/**
 * Circuly Customers Sync Workflow (with Pagination Support)
 *
 * This workflow synchronizes ALL customers from Circuly to the local database.
 * It fetches customers from Circuly API with pagination support, processes and validates the data,
 * then stores it in the customers table with proper deduplication.
 *
 * Features:
 * - Supports pagination to fetch all customers (not just first page)
 * - Uses Circuly's page-based pagination
 * - Configurable page size and max pages limit
 * - Tracks progress across multiple pages
 * - Uses unified integration action (credentials + plugin execution in one step)
 */

const circulySyncCustomersWorkflow = {
  workflowConfig: {
    name: 'Circuly Customers Sync',
    description:
      'Synchronize customers from Circuly to local database with pagination',
    version: '2.0.0',
    workflowType: 'predefined', // Predefined workflow - developer-defined, user provides credentials
    config: {
      timeout: 300000, // 5 minutes for full sync
      retryPolicy: { maxRetries: 3, backoffMs: 2000 },
      variables: {
        organizationId: 'org_demo',
        pageSize: 50, // Fetch 50 customers per page (Circuly max is 100)
        maxPages: 20, // Safety limit to prevent infinite loops
        currentPage: 1, // Track current page number (Circuly uses 1-based pagination)
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
        // schedule: '0 2 * * *', // Daily at 2 AM
        // timezone: 'UTC',
      },
      nextSteps: { success: 'fetch_customers' },
    },

    // Step 2: Fetch Customers from Circuly (unified integration action)
    // This single step handles: loading credentials + executing plugin
    {
      stepSlug: 'fetch_customers',
      name: 'Fetch Customers from Circuly',
      stepType: 'action',
      order: 2,
      config: {
        type: 'integration',
        parameters: {
          name: 'circuly',
          operation: 'list_customers',
          params: {
            page: '{{currentPage}}',
            per_page: '{{pageSize}}',
            sort: 'created_at',
            desc: false, // Oldest first for consistent sync
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
        expression: 'steps.query_existing_customer.output.data.items|length > 0',
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
            address: {
              street: '{{loop.item.address.shipping.street}}',
              city: '{{loop.item.address.shipping.city}}',
              country: '{{loop.item.address.shipping.country}}',
              postalCode: '{{loop.item.address.shipping.postal_code}}',
            },
            status: 'active',
            source: 'circuly',
            locale: '{{loop.item.default_locale}}',
            metadata: {
              circuly: '{{loop.item}}',
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
          address: {
            street: '{{loop.item.address.shipping.street}}',
            city: '{{loop.item.address.shipping.city}}',
            country: '{{loop.item.address.shipping.country}}',
            postalCode: '{{loop.item.address.shipping.postal_code}}',
          },
          externalId: '{{loop.item.id}}',
          status: 'active',
          source: 'circuly',
          locale: '{{loop.item.default_locale}}',
          metadata: {
            circuly: '{{loop.item}}',
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
          'Check if Circuly has more pages and we have not exceeded max page limit',
      },
      nextSteps: {
        true: 'prepare_next_page',
        false: 'noop',
      },
    },

    // Step 9: Prepare Next Page (increment counter)
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
          ],
        },
      },
      nextSteps: {
        success: 'fetch_customers', // Loop back to fetch next page
      },
    },
  ],
};

export default circulySyncCustomersWorkflow;
