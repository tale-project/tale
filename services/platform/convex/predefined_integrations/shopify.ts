/**
 * Shopify Integration Definition
 *
 * Predefined integration for Shopify Admin API.
 * Includes both connection config and connector code.
 */

import type { PredefinedIntegration } from './types';

const SHOPIFY_CONNECTOR_CODE = `
// Shopify Connector - Fetch data from Shopify Admin API
// This connector runs in a sandboxed environment with controlled HTTP access

const SHOPIFY_API_VERSION = '2024-01';

function normalizeShopDomain(domain) {
  return domain
    .replace(/^https?:\\/\\//, '')
    .split(/[/?#]/)[0]
    .replace(/\\/+$/, '');
}

const connector = {
  operations: [
    'list_products', 'get_product', 'list_customers', 'get_customer',
    'list_orders', 'get_order', 'count_products', 'count_customers', 'count_orders',
  ],

  testConnection: function(ctx) {
    var domain = ctx.secrets.get('domain');
    var accessToken = ctx.secrets.get('accessToken');

    if (!domain) {
      throw new Error('Shopify domain is required.');
    }
    if (!accessToken) {
      throw new Error('Shopify access token is required.');
    }

    var cleanDomain = normalizeShopDomain(domain);
    var shopDomain = cleanDomain.includes('.myshopify.com')
      ? cleanDomain : cleanDomain + '.myshopify.com';

    var url = 'https://' + shopDomain + '/admin/api/' + SHOPIFY_API_VERSION + '/shop.json';

    var response = ctx.http.get(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401) {
      throw new Error('Shopify authentication failed. Please verify your access token is correct and starts with "shpat_".');
    }
    if (response.status === 403) {
      throw new Error('Shopify access denied. Please verify your app has the required API scopes.');
    }
    if (response.status === 404) {
      throw new Error('Shopify store not found. Please verify your domain.');
    }
    if (response.status !== 200) {
      throw new Error('Shopify connection failed (' + response.status + '): ' + response.text());
    }

    var data = response.json();
    if (!data.shop) {
      throw new Error('Invalid response from Shopify API');
    }

    return { status: 'ok', shopName: data.shop.name };
  },

  execute: function(ctx) {
    const { operation, params, http, secrets } = ctx;

    // Get credentials - domain from params or secrets, token from secrets
    const domain = params.domain || secrets.get('domain');
    const accessToken = secrets.get('accessToken');

    if (!domain) {
      throw new Error('Shopify domain is required.');
    }
    if (!accessToken) {
      throw new Error('Shopify access token is required.');
    }

    // Clean and normalize domain
    const cleanDomain = normalizeShopDomain(domain);
    const shopDomain = cleanDomain.includes('.myshopify.com')
      ? cleanDomain : cleanDomain + '.myshopify.com';

    // Build the API URL
    const endpoint = buildEndpoint(operation, params);
    const url = 'https://' + shopDomain + '/admin/api/' + SHOPIFY_API_VERSION + '/' + endpoint + '.json';

    const queryParams = buildQueryParams(operation, params);
    const fullUrl = queryParams ? url + '?' + queryParams : url;

    console.log('Making Shopify request to: ' + fullUrl);

    const response = http.get(fullUrl, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
        'User-Agent': 'TaleCorp-Connector/1.0'
      }
    });

    if (response.status !== 200) {
      throw new Error('Shopify API error (' + response.status + '): ' + response.text());
    }

    const data = response.json();
    const result = extractData(operation, data);
    const pagination = extractPagination(response);

    return {
      success: true,
      operation: operation,
      data: result.data,
      count: result.count,
      pagination: pagination,
      timestamp: Date.now()
    };
  }
};

function buildEndpoint(operation, params) {
  const parts = operation.split('_');
  const action = parts[0];
  const resource = parts.slice(1).join('_');
  if (action === 'get' && params.resourceId) return resource + '/' + params.resourceId;
  if (action === 'count') return resource + '/count';
  return resource;
}

function buildQueryParams(operation, params) {
  const queryParts = [];
  if (operation.startsWith('list_')) {
    const limit = Math.min(params.limit || 50, 250);
    queryParts.push('limit=' + limit);
    if (params.page_info) queryParts.push('page_info=' + params.page_info);
    if (params.since_id) queryParts.push('since_id=' + params.since_id);
    if (params.created_at_min) queryParts.push('created_at_min=' + params.created_at_min);
    if (params.updated_at_min) queryParts.push('updated_at_min=' + params.updated_at_min);
    if (params.status) queryParts.push('status=' + params.status);
    if (params.fields) queryParts.push('fields=' + params.fields);
  }
  return queryParts.join('&');
}

function extractData(operation, responseData) {
  const parts = operation.split('_');
  const action = parts[0];
  const resource = parts.slice(1).join('_');
  if (action === 'count') return { data: responseData, count: responseData.count || 0 };
  const keyMap = {
    'products': action === 'get' ? 'product' : 'products',
    'customers': action === 'get' ? 'customer' : 'customers',
    'orders': action === 'get' ? 'order' : 'orders'
  };
  const key = keyMap[resource] || resource;
  const data = responseData[key];
  return { data: data, count: Array.isArray(data) ? data.length : (data ? 1 : 0) };
}

function extractPagination(response) {
  const linkHeader = response.headers['link'] || response.headers['Link'] || '';
  let nextPageInfo = null, hasNextPage = false;
  if (linkHeader) {
    const links = linkHeader.split(',');
    for (const link of links) {
      if (link.includes('rel="next"')) {
        const match = link.match(/page_info=([^>&]+)/);
        if (match) { nextPageInfo = match[1]; hasNextPage = true; }
      }
    }
  }
  return { hasNextPage: hasNextPage, nextPageInfo: nextPageInfo };
}
`;

export const shopifyIntegration: PredefinedIntegration = {
  name: 'shopify',
  title: 'Shopify',
  description:
    'Shopify Admin API integration for products, customers, and orders',
  defaultAuthMethod: 'api_key',
  connector: {
    code: SHOPIFY_CONNECTOR_CODE,
    version: 1,
    operations: [
      {
        name: 'list_products',
        title: 'List Products',
        description: 'Fetch products from Shopify',
      },
      {
        name: 'get_product',
        title: 'Get Product',
        description: 'Fetch a single product by ID',
      },
      {
        name: 'list_customers',
        title: 'List Customers',
        description: 'Fetch customers from Shopify',
      },
      {
        name: 'get_customer',
        title: 'Get Customer',
        description: 'Fetch a single customer by ID',
      },
      {
        name: 'list_orders',
        title: 'List Orders',
        description: 'Fetch orders from Shopify',
      },
      {
        name: 'get_order',
        title: 'Get Order',
        description: 'Fetch a single order by ID',
      },
      {
        name: 'count_products',
        title: 'Count Products',
        description: 'Get total product count',
      },
      {
        name: 'count_customers',
        title: 'Count Customers',
        description: 'Get total customer count',
      },
      {
        name: 'count_orders',
        title: 'Count Orders',
        description: 'Get total order count',
      },
    ],
    // Secret bindings map to integration credentials:
    // - 'domain' maps to connectionConfig.domain
    // - 'accessToken' maps to apiKeyAuth.keyEncrypted (decrypted)
    secretBindings: ['domain', 'accessToken'],
    allowedHosts: ['myshopify.com'],
    timeoutMs: 30000,
  },
  defaultConnectionConfig: {
    apiVersion: '2024-01',
    timeout: 30000,
  },
  defaultCapabilities: {
    canSync: true,
    canPush: false,
    canWebhook: true,
    syncFrequency: 'hourly',
  },
};
