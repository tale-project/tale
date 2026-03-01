// ─── Sandbox API Types ──────────────────────────────────────────────────────
// These types describe the APIs available inside the integration sandbox.
// They are stripped during transpilation and exist only for editor support.

interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  text(): string;
  json(): unknown;
}

interface HttpMethodOptions {
  headers?: Record<string, string>;
  responseType?: 'base64';
}

interface BodyMethodOptions extends HttpMethodOptions {
  body?: string;
  binaryBody?: string;
}

interface HttpApi {
  get(url: string, options?: HttpMethodOptions): HttpResponse;
  post(url: string, options?: BodyMethodOptions): HttpResponse;
  put(url: string, options?: BodyMethodOptions): HttpResponse;
  patch(url: string, options?: BodyMethodOptions): HttpResponse;
  delete(url: string, options?: BodyMethodOptions): HttpResponse;
}

interface SecretsApi {
  get(key: string): string | undefined;
}

interface FileReference {
  fileId: string;
  url: string;
  fileName: string;
  contentType: string;
  size: number;
}

interface FilesApi {
  download(
    url: string,
    options: { headers?: Record<string, string>; fileName: string },
  ): FileReference;
  store(
    data: string,
    options: {
      encoding: 'base64' | 'utf-8';
      contentType: string;
      fileName: string;
    },
  ): FileReference;
}

interface ConnectorContext {
  operation: string;
  params: Record<string, unknown>;
  http: HttpApi;
  secrets: SecretsApi;
  base64Encode(input: string): string;
  base64Decode(input: string): string;
  files?: FilesApi;
}

interface TestConnectionContext {
  http: HttpApi;
  secrets: SecretsApi;
  base64Encode(input: string): string;
  base64Decode(input: string): string;
  files?: FilesApi;
}

// ─────────────────────────────────────────────────────────────────────────────

// Shopify Connector - Fetch data from Shopify Admin API
// This connector runs in a sandboxed environment with controlled HTTP access

const SHOPIFY_API_VERSION = '2026-01';

function normalizeShopDomain(domain: string): string {
  return domain
    .replace(/^https?:\/\//, '')
    .split(/[/?#]/)[0]
    .replace(/\/+$/, '');
}

const connector = {
  operations: [
    'list_products',
    'get_product',
    'list_customers',
    'get_customer',
    'list_orders',
    'get_order',
    'count_products',
    'count_customers',
    'count_orders',
  ],

  testConnection: function (ctx: TestConnectionContext) {
    const domain = ctx.secrets.get('domain');
    const accessToken = ctx.secrets.get('accessToken');

    if (!domain) {
      throw new Error('Shopify domain is required.');
    }
    if (!accessToken) {
      throw new Error('Shopify access token is required.');
    }

    const cleanDomain = normalizeShopDomain(domain);
    const shopDomain = cleanDomain.endsWith('.myshopify.com')
      ? cleanDomain
      : cleanDomain + '.myshopify.com';

    const url =
      'https://' +
      shopDomain +
      '/admin/api/' +
      SHOPIFY_API_VERSION +
      '/shop.json';

    const response = ctx.http.get(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 401) {
      throw new Error(
        'Shopify authentication failed. Please verify your access token is correct and starts with "shpat_".',
      );
    }
    if (response.status === 403) {
      throw new Error(
        'Shopify access denied. Please verify your app has the required API scopes.',
      );
    }
    if (response.status === 404) {
      throw new Error('Shopify store not found. Please verify your domain.');
    }
    if (response.status !== 200) {
      throw new Error(
        'Shopify connection failed (' +
          response.status +
          '): ' +
          response.text(),
      );
    }

    const data = response.json() as Record<string, unknown>;
    if (!data.shop) {
      throw new Error('Invalid response from Shopify API');
    }

    return {
      status: 'ok',
      shopName: (data.shop as Record<string, unknown>).name,
    };
  },

  execute: function (ctx: ConnectorContext) {
    const { operation, params, http, secrets } = ctx;

    // Get credentials - domain from params or secrets, token from secrets
    const domain = (params.domain as string) || secrets.get('domain');
    const accessToken = secrets.get('accessToken');

    if (!domain) {
      throw new Error('Shopify domain is required.');
    }
    if (!accessToken) {
      throw new Error('Shopify access token is required.');
    }

    // Clean and normalize domain
    const cleanDomain = normalizeShopDomain(domain);
    const shopDomain = cleanDomain.endsWith('.myshopify.com')
      ? cleanDomain
      : cleanDomain + '.myshopify.com';

    // Build the API URL
    const endpoint = buildEndpoint(operation, params);
    const url =
      'https://' +
      shopDomain +
      '/admin/api/' +
      SHOPIFY_API_VERSION +
      '/' +
      endpoint +
      '.json';

    const queryParams = buildQueryParams(operation, params);
    const fullUrl = queryParams ? url + '?' + queryParams : url;

    console.log('Making Shopify request to: ' + fullUrl);

    const response = http.get(fullUrl, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
        'User-Agent': 'TaleCorp-Connector/1.0',
      },
    });

    if (response.status !== 200) {
      throw new Error(
        'Shopify API error (' + response.status + '): ' + response.text(),
      );
    }

    const data = response.json() as Record<string, unknown>;
    const result = extractData(operation, data);
    const pagination = extractPagination(response);

    return {
      success: true,
      operation: operation,
      data: result.data,
      count: result.count,
      pagination: pagination,
      timestamp: Date.now(),
    };
  },
};

function buildEndpoint(
  operation: string,
  params: Record<string, unknown>,
): string {
  const parts = operation.split('_');
  const action = parts[0];
  const resource = parts.slice(1).join('_');
  if (action === 'get') {
    if (!params.resourceId) {
      throw new Error('resourceId is required for ' + operation);
    }
    return resource + '/' + params.resourceId;
  }
  if (action === 'count') return resource + '/count';
  return resource;
}

function buildQueryParams(
  operation: string,
  params: Record<string, unknown>,
): string {
  const queryParts: string[] = [];
  const addParam = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    queryParts.push(key + '=' + encodeURIComponent(String(value)));
  };
  if (operation.startsWith('list_')) {
    const limit = Math.min((params.limit as number) || 50, 250);
    addParam('limit', limit);
    addParam('page_info', params.page_info);
    addParam('since_id', params.since_id);
    addParam('created_at_min', params.created_at_min);
    addParam('updated_at_min', params.updated_at_min);
    addParam('status', params.status);
    addParam('fields', params.fields);
  }
  return queryParts.join('&');
}

function extractData(
  operation: string,
  responseData: Record<string, unknown>,
): { data: unknown; count: number } {
  const parts = operation.split('_');
  const action = parts[0];
  const resource = parts.slice(1).join('_');
  if (action === 'count')
    return { data: responseData, count: (responseData.count as number) || 0 };
  const keyMap: Record<string, string> = {
    products: action === 'get' ? 'product' : 'products',
    customers: action === 'get' ? 'customer' : 'customers',
    orders: action === 'get' ? 'order' : 'orders',
  };
  const key = keyMap[resource] || resource;
  const data = responseData[key];
  return {
    data: data,
    count: Array.isArray(data) ? data.length : data ? 1 : 0,
  };
}

function extractPagination(response: HttpResponse): {
  hasNextPage: boolean;
  nextPageInfo: string | null;
} {
  const linkHeader = response.headers['link'] || response.headers['Link'] || '';
  let nextPageInfo: string | null = null;
  let hasNextPage = false;
  if (linkHeader) {
    const links = linkHeader.split(',');
    for (const link of links) {
      if (link.includes('rel="next"')) {
        const match = link.match(/page_info=([^>&]+)/);
        if (match) {
          nextPageInfo = match[1];
          hasNextPage = true;
        }
      }
    }
  }
  return { hasNextPage: hasNextPage, nextPageInfo: nextPageInfo };
}
