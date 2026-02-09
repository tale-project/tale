/**
 * Get workflow definitions and schedule configs for an integration
 */

import type { PredefinedWorkflowDefinition } from '../workflows/definitions/types';

import circulySyncCustomers from '../predefined_workflows/circuly_sync_customers';
import circulySyncProducts from '../predefined_workflows/circuly_sync_products';
import circulySyncSubscriptions from '../predefined_workflows/circuly_sync_subscriptions';
import shopifySyncCustomers from '../predefined_workflows/shopify_sync_customers';
// Import workflow definitions
import shopifySyncProducts from '../predefined_workflows/shopify_sync_products';

type WorkflowScheduleConfig = {
  schedule: string; // Cron expression
  timezone: string;
};

/**
 * Get workflows for an integration by name
 */
export function getWorkflowsForIntegration(name: string): {
  workflows: PredefinedWorkflowDefinition[];
  schedules: WorkflowScheduleConfig[];
} {
  switch (name) {
    case 'shopify':
      return {
        workflows: [shopifySyncProducts, shopifySyncCustomers],
        schedules: [
          { schedule: '0 */6 * * *', timezone: 'UTC' }, // Products: Every 6 hours
          { schedule: '0 */6 * * *', timezone: 'UTC' }, // Customers: Every 6 hours
        ],
      };

    case 'circuly':
      return {
        workflows: [
          circulySyncCustomers,
          circulySyncProducts,
          circulySyncSubscriptions,
        ],
        schedules: [
          { schedule: '0 2 * * *', timezone: 'UTC' }, // Customers: Daily at 2 AM
          { schedule: '0 */6 * * *', timezone: 'UTC' }, // Products: Every 6 hours
          { schedule: '0 3 * * *', timezone: 'UTC' }, // Subscriptions: Daily at 3 AM
        ],
      };

    default:
      return { workflows: [], schedules: [] };
  }
}
