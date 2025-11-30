/**
 * Circuly Integration Definition
 *
 * Predefined integration for Circuly API.
 * Includes both connection config and connector code.
 */

import type { PredefinedIntegration } from './types';

const CIRCULY_CONNECTOR_CODE = `
// Circuly Connector - Fetch data from Circuly API
// This connector runs in a sandboxed environment with controlled HTTP access

const CIRCULY_API_VERSION = '2025-01';

const connector = {
  operations: [
    'list_products', 'list_customers', 'list_subscriptions',
  ],

  execute: function(ctx) {
    const { operation, params, http, secrets } = ctx;

    // Get credentials from secrets
    const username = secrets.get('username');
    const password = secrets.get('password');

    if (!username || !password) {
      throw new Error('Circuly credentials (username, password) are required.');
    }

    // Parse operation to get resource
    const parts = operation.split('_');
    const resource = parts.slice(1).join('_');

    // Build URL
    const baseUrl = 'https://api.circuly.io/api/' + CIRCULY_API_VERSION;
    const endpoint = '/' + resource;

    // Build query parameters
    const queryParts = [];
    const page = params.page || 1;
    const perPage = Math.min(params.per_page || 50, 100);
    queryParts.push('page=' + page);
    queryParts.push('per_page=' + perPage);

    if (params.sort) queryParts.push('sort=' + params.sort);
    if (params.desc !== undefined) queryParts.push('desc=' + params.desc);
    if (params.id) queryParts.push('id=' + params.id);
    if (params.customer_id) queryParts.push('customer_id=' + params.customer_id);
    if (params.status) queryParts.push('status=' + params.status);

    const fullUrl = baseUrl + endpoint + '?' + queryParts.join('&');
    console.log('Making Circuly request to: ' + fullUrl);

    // Create Basic Auth header using base64 helper from context
    const authString = ctx.base64Encode(username + ':' + password);

    const response = http.get(fullUrl, {
      headers: {
        'Authorization': 'Basic ' + authString,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'TaleCorp-Connector/1.0'
      }
    });

    if (response.status !== 200) {
      throw new Error('Circuly API error (' + response.status + '): ' + response.text());
    }

    const responseData = response.json();
    const data = responseData.data;
    const meta = responseData.meta;

    // Extract pagination
    var pagination = null;
    if (meta) {
      const currentPage = meta.current_page || 1;
      const lastPage = meta.last_page || 1;
      pagination = {
        currentPage: currentPage,
        perPage: meta.per_page || 0,
        total: meta.total || 0,
        lastPage: lastPage,
        hasNextPage: currentPage < lastPage,
        hasPrevPage: currentPage > 1
      };
    }

    return {
      success: true,
      operation: operation,
      resource: resource,
      data: data,
      count: Array.isArray(data) ? data.length : (data ? 1 : 0),
      pagination: pagination,
      filterable: responseData.filterable,
      timestamp: Date.now()
    };
  }
};
`;

export const circulyIntegration: PredefinedIntegration = {
  name: 'circuly',
  title: 'Circuly',
  description:
    'Circuly API integration for products, customers, and subscriptions',
  defaultAuthMethod: 'basic_auth',
  connector: {
    code: CIRCULY_CONNECTOR_CODE,
    version: 1,
    operations: [
      {
        name: 'list_products',
        title: 'List Products',
        description: 'Fetch products from Circuly',
      },
      {
        name: 'list_customers',
        title: 'List Customers',
        description: 'Fetch customers from Circuly',
      },
      {
        name: 'list_subscriptions',
        title: 'List Subscriptions',
        description: 'Fetch subscriptions from Circuly',
      },
    ],
    // Secret bindings map to integration credentials:
    // - 'username' maps to basicAuth.username
    // - 'password' maps to basicAuth.passwordEncrypted (decrypted)
    secretBindings: ['username', 'password'],
    allowedHosts: ['circuly.io'],
    timeoutMs: 30000,
  },
  defaultConnectionConfig: {
    apiEndpoint: 'https://api.circuly.io/api/2025-01',
    timeout: 30000,
  },
  defaultCapabilities: {
    canSync: true,
    canPush: false,
    canWebhook: false,
    syncFrequency: 'hourly',
  },
};
