/**
 * Circuly Products Sync Workflow (with Pagination Support)
 *
 * This workflow synchronizes ALL products from Circuly to the local database.
 * It fetches products from Circuly API with pagination support, processes and validates the data,
 * then stores it in the products table with proper deduplication.
 *
 * Features:
 * - Supports pagination to fetch all products (not just first page)
 * - Uses Circuly's page-based pagination
 * - Configurable page size and max pages limit
 * - Tracks progress across multiple pages
 * - Secure credential management using encrypted secrets
 * - Maps Circuly product fields to local product schema
 */

const circulySyncProductsWorkflow = {
  workflowConfig: {
    name: 'Circuly Products Sync',
    description:
      'Synchronize products from Circuly to local database with pagination',
    version: '1.0.0',
    workflowType: 'predefined', // Predefined workflow - developer-defined, user provides credentials
    config: {
      timeout: 300000, // 5 minutes for full sync
      retryPolicy: { maxRetries: 3, backoffMs: 2000 },
      variables: {
        organizationId: 'org_demo',
        pageSize: 50, // Fetch 50 products per page (Circuly max is 100)
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
      stepType: 'start',
      order: 1,
      config: {},
      nextSteps: { success: 'fetch_products' },
    },

    // Step 2: Fetch Products from Circuly (with pagination)
    {
      stepSlug: 'fetch_products',
      name: 'Fetch Products from Circuly',
      stepType: 'action',
      order: 2,
      config: {
        type: 'integration',
        parameters: {
          name: 'circuly',
          operation: 'list_products',
          params: {
            page: '{{currentPage}}',
            per_page: '{{pageSize}}',
            sort: 'created_at',
            desc: false, // Oldest first for consistent sync
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
      order: 5,
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
      order: 6,
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
      name: 'Check Product Exists',
      stepType: 'condition',
      order: 7,
      config: {
        expression: 'steps.query_existing_product.output.data.page|length > 0',
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
      order: 8,
      config: {
        type: 'product',
        parameters: {
          operation: 'update',
          productId: '{{steps.query_existing_product.output.data.page[0]._id}}',
          updates: {
            name: '{{loop.item.title}}',
            description: '{{loop.item.title}}',
            imageUrl: '{{loop.item.picture_url}}',
            stock: '{{loop.item.stock}}',
            price: '{{loop.item.msrp}}',
            status: '{{loop.item.active ? "active" : "inactive"}}',
            category: '{{loop.item.product_collection_title}}',
            metadata: {
              circuly: '{{loop.item}}',
              syncedAt: '{{now}}',
              sku: '{{loop.item.sku}}',
              buyoutRetailPrice: '{{loop.item.buyout_retail_price}}',
              purchasePrice: '{{loop.item.purchase_price}}',
              shopId: '{{loop.item.shop_id}}',
              variantAmount: '{{loop.item.variant_amount}}',
              syncStock: '{{loop.item.sync_stock}}',
            },
          },
        },
      },
      nextSteps: {
        success: 'loop_products', // Continue to next product
      },
    },

    // Step 7: Insert New Product
    {
      stepSlug: 'insert_new_product',
      name: 'Insert New Product',
      stepType: 'action',
      order: 9,
      config: {
        type: 'product',
        parameters: {
          operation: 'create',
          name: '{{loop.item.title}}',
          description: '{{loop.item.title}}',
          imageUrl: '{{loop.item.picture_url}}',
          stock: '{{loop.item.stock}}',
          price: '{{loop.item.msrp}}',
          status: '{{loop.item.active ? "active" : "inactive"}}',
          category: '{{loop.item.product_collection_title}}',
          externalId: '{{loop.item.id}}',
          metadata: {
            circuly: '{{loop.item}}',
            syncedAt: '{{now}}',
            sku: '{{loop.item.sku}}',
            buyoutRetailPrice: '{{loop.item.buyout_retail_price}}',
            purchasePrice: '{{loop.item.purchase_price}}',
            shopId: '{{loop.item.shop_id}}',
            variantAmount: '{{loop.item.variant_amount}}',
            syncStock: '{{loop.item.sync_stock}}',
          },
        },
      },
      nextSteps: {
        success: 'loop_products', // Continue to next product
      },
    },

    // Step 8: Check if There's a Next Page (with page limit check)
    {
      stepSlug: 'check_has_next_page',
      name: 'Check Has Next Page',
      stepType: 'condition',
      order: 10,
      config: {
        expression:
          'steps.fetch_products.output.data.result.pagination.hasNextPage == true && currentPage < maxPages',
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
      order: 11,
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
        success: 'fetch_products', // Loop back to fetch next page
      },
    },
  ],
};

export default circulySyncProductsWorkflow;
