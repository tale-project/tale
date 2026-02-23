/**
 * Website Page Sync Workflow
 *
 * Incrementally syncs pending website pages by fetching content in batches.
 * Works in conjunction with the Website Scan workflow which discovers URLs
 * and registers them as pending pages.
 *
 * Features:
 * - Fetches pending pages in configurable batch sizes
 * - Loops through batches until all pending pages are synced or batch limit is reached
 * - Tracks progress with batch counter and safety limit
 * - Updates website status on completion
 */

const websitePageSyncWorkflow = {
  workflowConfig: {
    name: 'Website Page Sync',
    description:
      'Incrementally sync pending website pages by fetching content in batches.',
    version: '1.0.0',
    workflowType: 'predefined',
    config: {
      timeout: 600000, // 10 minutes
      retryPolicy: { maxRetries: 2, backoffMs: 5000 },
      variables: {
        organizationId: 'org_demo',
        websiteId: '',
        websiteDomain: '',
        batchSize: 50,
        wordCountThreshold: 100,
        crawlerTimeoutMs: 300000,
        maxBatches: 20,
        currentBatch: 0,
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
      nextSteps: { success: 'sync_batch' },
    },

    {
      stepSlug: 'sync_batch',
      name: 'Sync Pending Pages Batch',
      stepType: 'action',
      order: 2,
      config: {
        type: 'websitePages',
        parameters: {
          operation: 'sync_pending_pages',
          websiteId: '{{websiteId}}',
          batchSize: '{{batchSize}}',
          wordCountThreshold: '{{wordCountThreshold}}',
          crawlerTimeoutMs: '{{crawlerTimeoutMs}}',
        },
      },
      nextSteps: { success: 'check_has_more' },
    },

    {
      stepSlug: 'check_has_more',
      name: 'Check Has More Pages',
      stepType: 'condition',
      order: 3,
      config: {
        expression:
          'steps.sync_batch.output.data.hasMore == true && currentBatch < maxBatches',
      },
      nextSteps: {
        true: 'increment_batch',
        false: 'update_website_sync_status',
      },
    },

    {
      stepSlug: 'increment_batch',
      name: 'Increment Batch Counter',
      stepType: 'action',
      order: 4,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [{ name: 'currentBatch', value: '{{currentBatch + 1}}' }],
        },
      },
      nextSteps: { success: 'sync_batch' },
    },

    {
      stepSlug: 'update_website_sync_status',
      name: 'Update Website Sync Status',
      stepType: 'action',
      order: 5,
      config: {
        type: 'website',
        parameters: {
          operation: 'update',
          websiteId: '{{websiteId}}',
          lastScannedAt: '{{nowMs}}',
          metadata: {
            scan_status: 'synced',
            last_sync_timestamp: '{{nowMs}}',
            batches_processed: '{{currentBatch + 1}}',
          },
        },
      },
      nextSteps: { success: 'noop' },
    },
  ],
};

export default websitePageSyncWorkflow;
