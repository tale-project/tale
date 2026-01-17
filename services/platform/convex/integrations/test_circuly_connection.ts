/**
 * Test Circuly connection by making a simple API call
 */

import { CIRCULY_API_URL } from '../constants';

import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations]');

export async function testCirculyConnection(
  username: string,
  password: string,
): Promise<void> {
  // Skip health check in test mode (for testing the integration flow)
  // To enable test mode, use username: "test-skip-healthcheck"
  if (username === 'test-skip-healthcheck') {
    debugLog('Circuly Health Check TEST MODE - Skipping actual API call');
    return;
  }

  // Build Circuly API URL (versioned base)
  const urlObj = new URL(`${CIRCULY_API_URL}/customers`);
  urlObj.searchParams.set('per_page', '1');

  // Use basic auth to test the connection
  // btoa is available in both V8 and Node.js for base64 encoding
  const authString = btoa(`${username}:${password}`);

  try {
    const response = await fetch(urlObj.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Basic ${authString}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'TaleCorp-HealthCheck/1.0',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401) {
        throw new Error(
          'Circuly authentication failed. Please check your username and password.',
        );
      } else if (response.status === 403) {
        throw new Error(
          'Circuly access denied. Please verify your account permissions.',
        );
      } else {
        throw new Error(
          `Circuly connection failed (${response.status}): ${errorText}`,
        );
      }
    }

    const _data = await response.json();
    debugLog(`Circuly Health Check Successfully connected to account`);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(
      'Failed to connect to Circuly. Please check your credentials.',
    );
  }
}
