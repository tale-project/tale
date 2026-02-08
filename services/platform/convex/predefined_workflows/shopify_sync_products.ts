/**
 * Shopify Products Sync Workflow (with Pagination Support)
 *
 * This workflow synchronizes ALL products from Shopify to the local database.
 * It fetches products from Shopify API with pagination support, processes and validates the data,
 * then stores it in the products table with proper deduplication.
 *
 * Features:
 * - Supports pagination to fetch all products (not just first page)
 * - Uses Shopify's cursor-based pagination (page_info)
 * - Configurable page size and max pages limit
 * - Tracks progress across multiple pages
 * - Uses unified integration action (credentials + plugin execution in one step)
 */

const shopifySyncProductsWorkflow = {
  workflowConfig: {
    name: 'Shopify Products Sync',
    description:
      'Synchronize products from Shopify to local database with pagination',
    version: '3.0.0',
    workflowType: 'predefined', // Predefined workflow - developer-defined, user provides credentials
    config: {
      timeout: 300000, // 5 minutes for full sync
      retryPolicy: { maxRetries: 3, backoffMs: 2000 },
      variables: {
        organizationId: 'org_demo',
        pageSize: 10, // Fetch 10 products per page (Shopify max is 250)
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
      name: 'Start Products Sync',
      stepType: 'start',
      order: 1,
      config: {},
      nextSteps: { success: 'fetch_products' },
    },

    // Step 2: Fetch Products from Shopify (unified integration action)
    // This single step handles: loading credentials + executing plugin
    {
      stepSlug: 'fetch_products',
      name: 'Fetch Products from Shopify',
      stepType: 'action',
      order: 2,
      config: {
        type: 'integration',
        parameters: {
          name: 'shopify',
          operation: 'list_products',
          params: {
            limit: '{{pageSize}}', // Use configurable page size
            page_info: '{{nextPageInfo}}', // Cursor for pagination (null for first page)
            // Optional: Add date filters for incremental sync
            // updated_at_min: '{{lastSyncTime}}',
          },
        },
      },
      nextSteps: {
        success: 'loop_products',
      },
    },

    // Step 3: Loop Through Products (automatically handles empty arrays)
    {
      stepSlug: 'loop_products',
      name: 'Loop Through Products',
      stepType: 'loop',
      order: 3,
      config: {
        // Integration action returns: { result: { data: [...], pagination: {...} } }
        items: '{{steps.fetch_products.output.data.result.data}}',
        itemVariable: 'product',
      },
      nextSteps: {
        loop: 'query_existing_product',
        done: 'check_has_next_page',
      },
    },

    // Step 4: Query if Product Already Exists
    {
      stepSlug: 'query_existing_product',
      name: 'Query Existing Product',
      stepType: 'action',
      order: 4,
      config: {
        type: 'product',
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
        success: 'check_product_exists',
      },
    },

    // Step 5: Check if Product Exists
    {
      stepSlug: 'check_product_exists',
      name: 'Check if Product Exists',
      stepType: 'condition',
      order: 5,
      config: {
        expression: 'steps.query_existing_product.output.data.items|length > 0',
        description: 'Check if product already exists in database',
      },
      nextSteps: {
        true: 'update_existing_product',
        false: 'insert_new_product',
      },
    },

    // Step 6: Update Existing Product
    {
      stepSlug: 'update_existing_product',
      name: 'Update Existing Product',
      stepType: 'action',
      order: 6,
      config: {
        type: 'product',
        parameters: {
          operation: 'update',
          productId: '{{steps.query_existing_product.output.data.items[0]._id}}',
          updates: {
            name: '{{loop.item.title}}',
            status: '{{loop.item.status}}',
            metadata: {
              shopify: '{{loop.item}}',
              syncedAt: '{{now}}',
            },
          },
        },
      },
      nextSteps: {
        success: 'loop_products',
      },
    },

    // Step 7: Insert New Product
    {
      stepSlug: 'insert_new_product',
      name: 'Insert New Product',
      stepType: 'action',
      order: 7,
      config: {
        type: 'product',
        parameters: {
          operation: 'create',
          name: '{{loop.item.title}}',
          status: '{{loop.item.status}}',
          externalId: '{{loop.item.id}}',
          metadata: {
            shopify: '{{loop.item}}',
            syncedAt: '{{now}}',
          },
        },
      },
      nextSteps: {
        success: 'loop_products',
      },
    },

    // Step 8: Check if There's a Next Page
    {
      stepSlug: 'check_has_next_page',
      name: 'Check Has Next Page',
      stepType: 'condition',
      order: 8,
      config: {
        expression:
          'steps.fetch_products.output.data.result.pagination.hasNextPage == true',
        description: 'Check if Shopify has more pages to fetch',
      },
      nextSteps: {
        true: 'check_page_limit',
        false: 'noop',
      },
    },

    // Step 9: Check Page Limit (Safety Check)
    {
      stepSlug: 'check_page_limit',
      name: 'Check Page Limit',
      stepType: 'condition',
      order: 9,
      config: {
        expression: 'currentPage < maxPages',
        description: 'Ensure we do not exceed max page limit',
      },
      nextSteps: {
        true: 'update_pagination_vars',
        false: 'noop',
      },
    },

    // Step 10: Update Pagination Variables
    {
      stepSlug: 'update_pagination_vars',
      name: 'Update Pagination Variables',
      stepType: 'action',
      order: 10,
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
                '{{steps.fetch_products.output.data.result.pagination.nextPageInfo}}',
            },
          ],
        },
      },
      nextSteps: {
        success: 'fetch_products',
      },
    },
  ],
};

export default shopifySyncProductsWorkflow;
