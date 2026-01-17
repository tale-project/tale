/**
 * Test Shopify connection by making a simple API call
 */

import { SHOPIFY_API_VERSION } from './types';

import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations]');

export async function testShopifyConnection(
  domain: string,
  accessToken: string,
): Promise<void> {
  // Skip health check in test mode (for testing the integration flow)
  // To enable test mode, use domain: "test-skip-healthcheck.myshopify.com"
  if (domain.includes('test-skip-healthcheck')) {
    debugLog('Shopify Health Check TEST MODE - Skipping actual API call');
    return;
  }

  // Strip any protocol prefix (http:// or https://) from domain
  let cleanDomain = domain.replace(/^https?:\/\//, '');
  // Remove trailing slashes
  cleanDomain = cleanDomain.replace(/\/+$/, '');

  const shopDomain = cleanDomain.includes('.myshopify.com')
    ? cleanDomain
    : `${cleanDomain}.myshopify.com`;

  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/shop.json`;

  debugLog(`Shopify Health Check Testing connection to: ${shopDomain}`);
  debugLog(`Shopify Health Check Using API version: ${SHOPIFY_API_VERSION}`);
  debugLog(
    `Shopify Health Check Access token starts with: ${accessToken.substring(0, 10)}...`,
  );

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    debugLog(`Shopify Health Check Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Shopify Health Check] Error response:`, errorText);

      if (response.status === 401) {
        throw new Error(
          'Shopify authentication failed. Please verify: 1) Access token is correct and starts with "shpat_", 2) The custom app is installed in your store, 3) The token hasn\'t been revoked.',
        );
      } else if (response.status === 403) {
        throw new Error(
          'Shopify access denied. Please verify your custom app has the required API scopes (at minimum: read_products).',
        );
      } else if (response.status === 404) {
        throw new Error(
          'Shopify store not found. Please verify your domain is correct (e.g., "mystore.myshopify.com").',
        );
      } else {
        throw new Error(
          `Shopify connection failed (${response.status}): ${errorText}`,
        );
      }
    }

    const data = await response.json();
    if (!data.shop) {
      throw new Error('Invalid response from Shopify API');
    }

    debugLog(
      `Shopify Health Check Successfully connected to ${data.shop.name}`,
    );
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(
      'Failed to connect to Shopify. Please check your credentials.',
    );
  }
}
