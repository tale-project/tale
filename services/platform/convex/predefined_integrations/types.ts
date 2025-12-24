/**
 * Type definitions for predefined integrations
 */

import type { AuthMethod, ConnectorConfig } from '../model/integrations/types';

/**
 * SQL operation definition for predefined SQL integrations
 */
export interface SqlOperation {
  name: string;
  title?: string;
  description?: string;
  query: string;
  parametersSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * SQL connection config for predefined SQL integrations
 */
export interface SqlConnectionConfig {
  engine: 'mssql' | 'postgres' | 'mysql';
  server?: string; // Optional - user provides at setup time
  port?: number;
  database?: string; // Optional - user provides at setup time
  readOnly?: boolean;
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
    connectionTimeout?: number;
    requestTimeout?: number;
  };
  security?: {
    maxResultRows?: number;
    queryTimeoutMs?: number;
    maxConnectionPoolSize?: number;
  };
}

/**
 * Predefined integration definition
 * A template for creating integrations with pre-configured connector code or SQL operations
 */
export interface PredefinedIntegration {
  // Integration identity
  name: string; // Unique identifier (e.g., 'shopify', 'circuly', 'protel')
  title: string; // Display name
  description: string;

  // Integration type: 'rest_api' (default) or 'sql'
  type?: 'rest_api' | 'sql';

  // Default auth method for this integration
  defaultAuthMethod: AuthMethod;

  // Connector configuration (code + operations) - for REST API integrations
  connector: ConnectorConfig;

  // SQL-specific configuration - for SQL integrations
  sqlConnectionConfig?: SqlConnectionConfig;
  sqlOperations?: SqlOperation[];

  // Default connection config template (for REST API integrations)
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
