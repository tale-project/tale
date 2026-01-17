/**
 * Convex validators for integration operations
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  integrationTypeSchema,
  integrationAuthMethodSchema,
  integrationStatusSchema,
  operationTypeSchema,
  sqlEngineSchema,
  apiKeyAuthSchema,
  apiKeyAuthEncryptedSchema,
  basicAuthSchema,
  basicAuthEncryptedSchema,
  oauth2AuthSchema,
  oauth2AuthEncryptedSchema,
  connectionConfigSchema,
  capabilitiesSchema,
  connectorOperationSchema,
  connectorConfigSchema,
  sqlConnectionOptionsSchema,
  sqlSecuritySchema,
  sqlConnectionConfigSchema,
  sqlOperationSchema,
  testConnectionResultSchema,
  syncStatsSchema,
  integrationDocSchema,
} from '../../lib/shared/schemas/integrations';

export const integrationTypeValidator = zodToConvex(integrationTypeSchema);
export const authMethodValidator = zodToConvex(integrationAuthMethodSchema);
export const statusValidator = zodToConvex(integrationStatusSchema);
export const operationTypeValidator = zodToConvex(operationTypeSchema);
export const sqlEngineValidator = zodToConvex(sqlEngineSchema);
export const apiKeyAuthValidator = zodToConvex(apiKeyAuthSchema);
export const apiKeyAuthEncryptedValidator = zodToConvex(apiKeyAuthEncryptedSchema);
export const basicAuthValidator = zodToConvex(basicAuthSchema);
export const basicAuthEncryptedValidator = zodToConvex(basicAuthEncryptedSchema);
export const oauth2AuthValidator = zodToConvex(oauth2AuthSchema);
export const oauth2AuthEncryptedValidator = zodToConvex(oauth2AuthEncryptedSchema);
export const connectionConfigValidator = zodToConvex(connectionConfigSchema);
export const capabilitiesValidator = zodToConvex(capabilitiesSchema);
export const connectorOperationValidator = zodToConvex(connectorOperationSchema);
export const connectorConfigValidator = zodToConvex(connectorConfigSchema);
export const sqlConnectionOptionsValidator = zodToConvex(sqlConnectionOptionsSchema);
export const sqlSecurityValidator = zodToConvex(sqlSecuritySchema);
export const sqlConnectionConfigValidator = zodToConvex(sqlConnectionConfigSchema);
export const sqlOperationValidator = zodToConvex(sqlOperationSchema);
export const testConnectionResultValidator = zodToConvex(testConnectionResultSchema);
export const syncStatsValidator = zodToConvex(syncStatsSchema);
export const integrationDocValidator = zodToConvex(integrationDocSchema);
