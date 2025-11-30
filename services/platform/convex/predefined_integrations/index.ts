/**
 * Predefined Integrations Index
 *
 * Central export point for all predefined integrations (Shopify, Circuly, etc.)
 * Each predefined integration includes both connection config and connector code.
 */

import { shopifyIntegration } from './shopify';
import { circulyIntegration } from './circuly';
import type { PredefinedIntegration } from './types';

// Individual integration exports
export { shopifyIntegration } from './shopify';
export { circulyIntegration } from './circuly';
export type { PredefinedIntegration } from './types';

// All predefined integrations as an array for iteration
export const predefinedIntegrations: PredefinedIntegration[] = [
  shopifyIntegration,
  circulyIntegration,
];

// Name to definition map for O(1) lookups
export const predefinedIntegrationsMap: Record<string, PredefinedIntegration> =
  {
    shopify: shopifyIntegration,
    circuly: circulyIntegration,
  };

/**
 * Get predefined integration by name
 */
export function getPredefinedIntegration(
  name: string,
): PredefinedIntegration | undefined {
  return predefinedIntegrationsMap[name];
}

/**
 * Check if a name has a predefined integration
 */
export function hasPredefinedIntegration(name: string): boolean {
  return name in predefinedIntegrationsMap;
}
