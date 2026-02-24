/**
 * Website Scan Workflow — Discover URLs, register changes, and sync content
 *
 * This workflow reads URLs (with content hashes) from the crawler service's
 * persistent registry, registers new/changed/deleted pages in Convex,
 * and fetches content for new/updated pages.
 *
 * Flow:
 * start → fetch_main_page → update_metadata → query_urls → register_urls
 *       → sync_pages → check_has_more → (loop or update_status)
 */

const websiteScanWorkflow = {
  workflowConfig: {
    name: 'Website Scan',
    description: 'Discover URLs, register changes, and sync page content.',
    version: '3.0.0',
    workflowType: 'predefined',
    config: {
      timeout: 1800000,
      retryPolicy: { maxRetries: 2, backoffMs: 5000 },
      variables: {
        organizationId: 'org_demo',
        websiteUrl: 'https://burgenstockresort.com/',
        websiteDomain: 'burgenstockresort.com',
        scanInterval: '6h',
        maxPages: 100,
        wordCountThreshold: 100,
        crawlerTimeoutMs: 1800000,
        offset: 0,
      },
    },
  },

  stepsConfig: [
    {
      stepSlug: 'start',
      name: 'start',
      stepType: 'start',
      order: 1,
      config: {},
      nextSteps: { success: 'fetch_main_page' },
    },

    {
      stepSlug: 'fetch_main_page',
      name: 'Fetch Main Page',
      stepType: 'action',
      order: 2,
      config: {
        type: 'crawler',
        parameters: {
          operation: 'fetch_urls',
          urls: ['{{websiteUrl}}'],
          wordCountThreshold: '{{wordCountThreshold}}',
          timeout: '{{crawlerTimeoutMs}}',
        },
      },
      nextSteps: { success: 'update_metadata' },
    },

    {
      stepSlug: 'update_metadata',
      name: 'Update Website Metadata',
      stepType: 'action',
      order: 3,
      config: {
        type: 'website',
        parameters: {
          operation: 'update',
          websiteId: '{{websiteId}}',
          title:
            '{{steps.fetch_main_page.output.data.pages[0].metadata.title || steps.fetch_main_page.output.data.pages[0].title || websiteDomain}}',
          description:
            '{{steps.fetch_main_page.output.data.pages[0].metadata.description || ""}}',
          lastScannedAt: '{{nowMs}}',
          status: 'active',
          metadata: {
            scan_status: 'scanning',
            last_crawl_timestamp: '{{nowMs}}',
          },
        },
      },
      nextSteps: { success: 'query_urls' },
    },

    {
      stepSlug: 'query_urls',
      name: 'Query URLs',
      stepType: 'action',
      order: 4,
      config: {
        type: 'crawler',
        parameters: {
          operation: 'query_urls',
          domain: '{{websiteDomain}}',
          offset: '{{offset}}',
          limit: '{{maxPages}}',
          timeout: '{{crawlerTimeoutMs}}',
        },
      },
      nextSteps: { success: 'register_urls' },
    },

    {
      stepSlug: 'register_urls',
      name: 'Register URLs',
      stepType: 'action',
      order: 5,
      config: {
        type: 'websitePages',
        parameters: {
          operation: 'register_discovered_urls',
          websiteId: '{{websiteId}}',
          urls: '{{steps.query_urls.output.data.urls}}',
        },
      },
      nextSteps: { success: 'sync_pages' },
    },

    {
      stepSlug: 'sync_pages',
      name: 'Sync Pages',
      stepType: 'action',
      order: 6,
      config: {
        type: 'websitePages',
        parameters: {
          operation: 'sync_pending_pages',
          websiteId: '{{websiteId}}',
          urls: '{{steps.register_urls.output.data.urlsToSync}}',
          wordCountThreshold: '{{wordCountThreshold}}',
          crawlerTimeoutMs: '{{crawlerTimeoutMs}}',
        },
      },
      nextSteps: { success: 'check_has_more' },
    },

    {
      stepSlug: 'check_has_more',
      name: 'Check Has More',
      stepType: 'condition',
      order: 7,
      config: {
        expression: 'steps.query_urls.output.data.has_more == true',
      },
      nextSteps: {
        true: 'update_offset',
        false: 'update_status',
      },
    },

    {
      stepSlug: 'update_offset',
      name: 'Update Offset',
      stepType: 'action',
      order: 8,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [{ name: 'offset', value: '{{offset + maxPages}}' }],
        },
      },
      nextSteps: { success: 'query_urls' },
    },

    {
      stepSlug: 'update_status',
      name: 'Update Website Status',
      stepType: 'action',
      order: 9,
      config: {
        type: 'website',
        parameters: {
          operation: 'update',
          websiteId: '{{websiteId}}',
          status: 'active',
          lastScannedAt: '{{nowMs}}',
          metadata: {
            scan_status: 'complete',
            last_crawl_timestamp: '{{nowMs}}',
          },
        },
      },
      nextSteps: { success: 'noop' },
    },
  ],
};

export default websiteScanWorkflow;
