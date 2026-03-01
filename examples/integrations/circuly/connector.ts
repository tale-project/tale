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

// Circuly Connector - Fetch data from Circuly API
// This connector runs in a sandboxed environment with controlled HTTP access

const CIRCULY_API_VERSION = '2025-01';

const connector = {
  operations: ['list_products', 'list_customers', 'list_subscriptions'],

  testConnection: function (ctx: TestConnectionContext) {
    const username = ctx.secrets.get('username');
    const password = ctx.secrets.get('password');

    if (!username) {
      throw new Error('Circuly username is required.');
    }
    if (!password) {
      throw new Error('Circuly password is required.');
    }

    const authString = ctx.base64Encode(username + ':' + password);
    const url =
      'https://api.circuly.io/api/' +
      CIRCULY_API_VERSION +
      '/customers?per_page=1';

    const response = ctx.http.get(url, {
      headers: {
        Authorization: 'Basic ' + authString,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 401) {
      throw new Error(
        'Circuly authentication failed. Please verify your username and password.',
      );
    }
    if (response.status === 403) {
      throw new Error(
        'Circuly access denied. Please verify your account has API access.',
      );
    }
    if (response.status !== 200) {
      throw new Error(
        'Circuly connection failed (' +
          response.status +
          '): ' +
          response.text(),
      );
    }

    return { status: 'ok' };
  },

  execute: function (ctx: ConnectorContext) {
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
    const queryParts: string[] = [];
    const page = params.page || 1;
    const perPage = Math.min((params.per_page as number) || 50, 100);
    queryParts.push('page=' + page);
    queryParts.push('per_page=' + perPage);

    if (params.sort)
      queryParts.push('sort=' + encodeURIComponent(params.sort as string));
    if (params.desc !== undefined)
      queryParts.push('desc=' + encodeURIComponent(params.desc as string));
    if (params.id)
      queryParts.push('id=' + encodeURIComponent(params.id as string));
    if (params.customer_id)
      queryParts.push(
        'customer_id=' + encodeURIComponent(params.customer_id as string),
      );
    if (params.status)
      queryParts.push('status=' + encodeURIComponent(params.status as string));

    const fullUrl = baseUrl + endpoint + '?' + queryParts.join('&');

    // Create Basic Auth header using base64 helper from context
    const authString = ctx.base64Encode(username + ':' + password);

    const response = http.get(fullUrl, {
      headers: {
        Authorization: 'Basic ' + authString,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'TaleCorp-Connector/1.0',
      },
    });

    if (response.status !== 200) {
      throw new Error(
        'Circuly API error (' + response.status + '): ' + response.text(),
      );
    }

    const responseData = response.json() as Record<string, unknown>;
    const data = responseData.data as unknown[];
    const meta = responseData.meta as Record<string, number> | undefined;

    // Extract pagination
    let pagination = null;
    if (meta) {
      const currentPage = meta.current_page || 1;
      const lastPage = meta.last_page || 1;
      pagination = {
        currentPage: currentPage,
        perPage: meta.per_page || 0,
        total: meta.total || 0,
        lastPage: lastPage,
        hasNextPage: currentPage < lastPage,
        hasPrevPage: currentPage > 1,
      };
    }

    return {
      success: true,
      operation: operation,
      resource: resource,
      data: data,
      count: Array.isArray(data) ? data.length : data ? 1 : 0,
      pagination: pagination,
      filterable: responseData.filterable,
      timestamp: Date.now(),
    };
  },
};
