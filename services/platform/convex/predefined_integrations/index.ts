/**
 * Predefined Integrations Index
 *
 * Central export point for all predefined integrations (Shopify, Circuly, Protel, etc.)
 * Each predefined integration includes both connection config and connector code.
 */

import type { PredefinedIntegration } from './types';

import { circulyIntegration } from './circuly';
import { protelIntegration } from './protel';
import { shopifyIntegration } from './shopify';

// Individual integration exports
export * from './shopify';
export * from './circuly';
export * from './protel';
export * from './types';

// All predefined integrations as an array for iteration
export const predefinedIntegrations: PredefinedIntegration[] = [
  shopifyIntegration,
  circulyIntegration,
  protelIntegration,
];

// Name to definition map for O(1) lookups
export const predefinedIntegrationsMap: Record<string, PredefinedIntegration> =
  {
    shopify: shopifyIntegration,
    circuly: circulyIntegration,
    protel: protelIntegration,
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
