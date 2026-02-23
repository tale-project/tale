/**
 * Website Scan Workflow — Discovery Only
 *
 * This workflow discovers URLs for a website and registers them as pending pages.
 * Actual page content fetching is handled by the separate Website Page Sync workflow.
 *
 * Features:
 * - Fetches main page first to extract title and description from metadata
 * - Updates website record with title and description before URL discovery
 * - Discovers URLs using the crawler service (/api/v1/urls/discover)
 * - Registers discovered URLs as pending website pages
 * - Supports paginated discovery via offset-based looping
 * - Creates or updates website record with proper metadata
 * - Can be triggered manually or scheduled based on scanInterval
 */

const websiteScanWorkflow = {
  workflowConfig: {
    name: 'Website Scan',
    description:
      'Discover URLs for a website and register them as pending pages for later syncing.',
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
        offset: 0,
        discoveryId: '',
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
          'steps.check_existing_website_for_metadata.output.data != null',
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
            '{{steps.check_existing_website_for_metadata.output.data._id}}',
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

    // Step 7: Discover URLs (with offset for pagination)
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
          offset: '{{offset}}',
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
            '{{steps.create_website_with_metadata.output.data._id || steps.check_existing_website_for_metadata.output.data._id}}',
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
        success: 'register_discovered_urls',
      },
    },

    // Step 9: Register Discovered URLs as Pending Pages
    {
      stepSlug: 'register_discovered_urls',
      name: 'Register Discovered URLs',
      stepType: 'action',
      order: 9,
      config: {
        type: 'websitePages',
        parameters: {
          operation: 'register_discovered_urls',
          websiteId:
            '{{steps.create_website_with_metadata.output.data._id || steps.check_existing_website_for_metadata.output.data._id}}',
          urls: '{{steps.discover_urls.output.data.urls}}',
        },
      },
      nextSteps: { success: 'check_discovery_has_more' },
    },

    // Step 10: Check if Discovery Has More Pages
    {
      stepSlug: 'check_discovery_has_more',
      name: 'Check Discovery Has More',
      stepType: 'condition',
      order: 10,
      config: {
        expression: 'steps.discover_urls.output.data.is_complete == false',
      },
      nextSteps: {
        true: 'update_discovery_offset',
        false: 'update_website_status',
      },
    },

    // Step 11: Update Discovery Offset for Next Page
    {
      stepSlug: 'update_discovery_offset',
      name: 'Update Discovery Offset',
      stepType: 'action',
      order: 11,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [{ name: 'offset', value: '{{offset + maxPages}}' }],
        },
      },
      nextSteps: { success: 'discover_urls' },
    },

    // Step 12: Update Website - Mark Discovery Complete
    {
      stepSlug: 'update_website_status',
      name: 'Update Website - Mark Discovery Complete',
      stepType: 'action',
      order: 12,
      config: {
        type: 'website',
        parameters: {
          operation: 'update',
          websiteId:
            '{{steps.create_website_with_metadata.output.data._id || steps.check_existing_website_for_metadata.output.data._id}}',
          status: 'active',
          lastScannedAt: '{{nowMs}}',
          metadata: {
            urls_discovered:
              '{{steps.discover_urls.output.data.urls_discovered}}',
            urls_registered:
              '{{steps.register_discovered_urls.output.data.registered}}',
            scan_status: 'discovery_complete',
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
