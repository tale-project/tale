/**
 * Website Scan Workflow
 *
 * This workflow scans a website and saves/updates its details in the database.
 * Each website should have its own workflow instance with the domain defined in variables.
 *
 * Features:
 * - Fetches main page first to extract title and description from metadata
 * - Updates website record with title and description before URL discovery
 * - Discovers URLs using the crawler service (/api/v1/discover)
 * - Fetches content from discovered URLs (/api/v1/fetch-urls)
 * - Creates or updates website record with proper metadata
 * - Can be triggered manually or scheduled based on scanInterval
 */

export const websiteScanWorkflow = {
  workflowConfig: {
    name: 'Website Scan',
    description:
      'Scan a website and save its details to the database. Fetches main page first for metadata, then discovers and fetches all URLs.',
    version: '1.0.0',
    workflowType: 'predefined',
    config: {
      timeout: 1800000, // 30 minutes
      retryPolicy: { maxRetries: 2, backoffMs: 5000 },
      variables: {
        organizationId: 'org_demo',
        websiteUrl: 'https://burgenstockresort.com/',
        websiteDomain: 'burgenstockresort.com',
        scanInterval: '6h',
        maxPages: 1000,
        crawlerTimeoutMs: 1800000,
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
        type: 'manual',
        // For scheduled scan, change to:
        // type: 'schedule',
        // schedule: '0 */6 * * *', // Every 6 hours
        // timezone: 'UTC',
      },
      nextSteps: { success: 'fetch_main_page' },
    },

    // Step 2: Fetch Main Page to Get Title and Description
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
          wordCountThreshold: 100,
          timeout: '{{crawlerTimeoutMs}}',
        },
      },
      nextSteps: {
        success: 'check_existing_website_for_metadata',
      },
    },

    // Step 3: Check if Website Already Exists (for metadata update)
    {
      stepSlug: 'check_existing_website_for_metadata',
      name: 'Check Existing Website For Metadata',
      stepType: 'action',
      order: 3,
      config: {
        type: 'website',
        parameters: {
          operation: 'get_by_domain',
          organizationId: '{{organizationId}}',
          domain: '{{websiteDomain}}',
        },
      },
      nextSteps: {
        success: 'decide_create_or_update_metadata',
      },
    },

    // Step 4: Decide Whether to Create or Update (for metadata)
    {
      stepSlug: 'decide_create_or_update_metadata',
      name: 'Decide Create or Update Metadata',
      stepType: 'condition',
      order: 4,
      config: {
        expression:
          'steps.check_existing_website_for_metadata.output.data.found == true',
      },
      nextSteps: {
        true: 'update_website_metadata',
        false: 'create_website_with_metadata',
      },
    },

    // Step 5a: Create New Website with Metadata
    {
      stepSlug: 'create_website_with_metadata',
      name: 'Create Website With Metadata',
      stepType: 'action',
      order: 5,
      config: {
        type: 'website',
        parameters: {
          operation: 'create',
          organizationId: '{{organizationId}}',
          domain: '{{websiteDomain}}',
          title:
            '{{steps.fetch_main_page.output.data.pages[0].metadata.title || steps.fetch_main_page.output.data.pages[0].title || websiteDomain}}',
          description:
            '{{steps.fetch_main_page.output.data.pages[0].metadata.description || ""}}',
          scanInterval: '{{scanInterval}}',
          lastScannedAt: '{{nowMs}}',
          status: 'active',
          metadata: {
            scan_status: 'fetching_metadata',
            last_crawl_timestamp: '{{nowMs}}',
          },
        },
      },
      nextSteps: {
        success: 'discover_urls',
      },
    },

    // Step 5b: Update Existing Website with Metadata
    {
      stepSlug: 'update_website_metadata',
      name: 'Update Website Metadata',
      stepType: 'action',
      order: 6,
      config: {
        type: 'website',
        parameters: {
          operation: 'update',
          websiteId:
            '{{steps.check_existing_website_for_metadata.output.data.website._id}}',
          title:
            '{{steps.fetch_main_page.output.data.pages[0].metadata.title || steps.fetch_main_page.output.data.pages[0].title || websiteDomain}}',
          description:
            '{{steps.fetch_main_page.output.data.pages[0].metadata.description || ""}}',
          lastScannedAt: '{{nowMs}}',
          status: 'active',
          metadata: {
            scan_status: 'fetching_metadata',
            last_crawl_timestamp: '{{nowMs}}',
          },
        },
      },
      nextSteps: {
        success: 'discover_urls',
      },
    },

    // Step 7: Discover URLs
    {
      stepSlug: 'discover_urls',
      name: 'Discover URLs',
      stepType: 'action',
      order: 7,
      config: {
        type: 'crawler',
        parameters: {
          operation: 'discover_urls',
          url: '{{websiteUrl}}',
          domain: '{{websiteDomain}}',
          maxUrls: '{{maxPages}}',
          timeout: '{{crawlerTimeoutMs}}',
        },
      },
      nextSteps: {
        success: 'update_website_with_discovered_urls',
      },
    },

    // Step 8: Update Website with Discovered URLs Count
    {
      stepSlug: 'update_website_with_discovered_urls',
      name: 'Update Website With Discovered URLs',
      stepType: 'action',
      order: 8,
      config: {
        type: 'website',
        parameters: {
          operation: 'update',
          websiteId:
            '{{steps.create_website_with_metadata.output.data.websiteId || steps.check_existing_website_for_metadata.output.data.website._id}}',
          metadata: {
            urls_discovered:
              '{{steps.discover_urls.output.data.urls_discovered}}',
            urls_fetched: 0,
            scan_status: 'in_progress',
            last_crawl_timestamp: '{{nowMs}}',
          },
        },
      },
      nextSteps: {
        success: 'loop_urls',
      },
    },

    // Step 9: Loop Through URLs
    {
      stepSlug: 'loop_urls',
      name: 'Loop Through URLs',
      stepType: 'loop',
      order: 9,
      config: {
        items: "{{steps.discover_urls.output.data.urls|map('url')}}",
        itemVariable: 'url',
      },
      nextSteps: {
        loop: 'fetch_single_url',
        done: 'update_website_status',
      },
    },

    // Step 10: Fetch Single URL Content
    {
      stepSlug: 'fetch_single_url',
      name: 'Fetch Single URL Content',
      stepType: 'action',
      order: 10,
      config: {
        type: 'crawler',
        parameters: {
          operation: 'fetch_urls',
          urls: ['{{loop.item}}'],
          wordCountThreshold: 1000,
          timeout: '{{crawlerTimeoutMs}}',
        },
      },
      nextSteps: {
        success: 'save_single_page',
      },
    },

    // Step 11: Save Single Page to Database
    {
      stepSlug: 'save_single_page',
      name: 'Save Single Page',
      stepType: 'action',
      order: 11,
      config: {
        type: 'websitePages',
        parameters: {
          operation: 'bulk_upsert',
          organizationId: '{{organizationId}}',
          websiteId:
            '{{steps.create_website_with_metadata.output.data.websiteId || steps.check_existing_website_for_metadata.output.data.website._id}}',
          pages: '{{steps.fetch_single_url.output.data.pages}}',
        },
      },
      nextSteps: {
        success: 'loop_urls',
      },
    },

    // Step 12: Update Website - Mark Scan Complete
    {
      stepSlug: 'update_website_status',
      name: 'Update Website - Mark Scan Complete',
      stepType: 'action',
      order: 12,
      config: {
        type: 'website',
        parameters: {
          operation: 'update',
          websiteId:
            '{{steps.create_website_with_metadata.output.data.websiteId || steps.check_existing_website_for_metadata.output.data.website._id}}',
          status: 'active',
          lastScannedAt: '{{nowMs}}',
          metadata: {
            urls_discovered:
              '{{steps.discover_urls.output.data.urls_discovered}}',
            urls_fetched: '{{loop.state.iterations}}',
            scan_status: 'completed',
            last_crawl_timestamp: '{{nowMs}}',
          },
        },
      },
      nextSteps: {
        success: 'noop',
      },
    },
  ],
};

export default websiteScanWorkflow;
