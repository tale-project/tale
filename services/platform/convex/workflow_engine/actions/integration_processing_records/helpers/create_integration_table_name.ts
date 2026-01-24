/**
 * Utility functions for integration processing records
 */

/**
 * Integration table name pattern: integration:<integration>:<tag>
 */
export type IntegrationTableName = `integration:${string}:${string}`;

/**
 * Create an integration table name from components
 *
 * @param integration - The integration name (e.g., 'protel', 'shopify')
 * @param tag - The processing scenario tag (e.g., 'upcoming_arrivals', 'orders')
 * @returns The formatted table name
 */
export function createIntegrationTableName(
  integration: string,
  tag: string,
): IntegrationTableName {
  return `integration:${integration}:${tag}`;
}
