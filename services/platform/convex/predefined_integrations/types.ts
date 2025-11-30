/**
 * Type definitions for predefined integrations
 */

import type { AuthMethod, ConnectorConfig } from '../model/integrations/types';

/**
 * Predefined integration definition
 * A template for creating integrations with pre-configured connector code
 */
export interface PredefinedIntegration {
  // Integration identity
  name: string; // Unique identifier (e.g., 'shopify', 'circuly')
  title: string; // Display name
  description: string;

  // Default auth method for this integration
  defaultAuthMethod: AuthMethod;

  // Connector configuration (code + operations)
  connector: ConnectorConfig;

  // Default connection config template
  defaultConnectionConfig?: {
    domain?: string;
    apiVersion?: string;
    apiEndpoint?: string;
    timeout?: number;
    rateLimit?: number;
  };

  // Default capabilities
  defaultCapabilities?: {
    canSync?: boolean;
    canPush?: boolean;
    canWebhook?: boolean;
    syncFrequency?: string;
  };
}
