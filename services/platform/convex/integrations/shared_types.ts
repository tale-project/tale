/**
 * Structural interface for functions that need to access integration credentials.
 *
 * Satisfied by both Doc<'integrations'> (legacy) and LoadedIntegration (file-based).
 * Use this in shared helpers that must work with either source during the migration.
 */

import type { Id } from '../_generated/dataModel';

export interface IntegrationWithCredentials {
  _id: Id<'integrations'> | Id<'integrationCredentials'>;
  authMethod: 'api_key' | 'bearer_token' | 'basic_auth' | 'oauth2';
  connectionConfig?: {
    domain?: string;
    apiVersion?: string;
    apiEndpoint?: string;
    timeout?: number;
    rateLimit?: number;
  };
  apiKeyAuth?: { keyEncrypted: string; keyPrefix?: string };
  basicAuth?: { username: string; passwordEncrypted: string };
  oauth2Auth?: {
    accessTokenEncrypted: string;
    refreshTokenEncrypted?: string;
    tokenExpiry?: number;
    scopes?: string[];
  };
  oauth2Config?: {
    authorizationUrl: string;
    tokenUrl: string;
    scopes?: string[];
    clientId?: string;
    clientSecretEncrypted?: string;
  };
  /**
   * Secret binding names declared in the integration's config.json. The first
   * entry determines the key used for api_key / bearer_token / oauth2 secrets
   * (defaults to 'accessToken' when unset, for legacy DB rows that never
   * recorded the bindings).
   */
  secretBindings?: string[];
}
