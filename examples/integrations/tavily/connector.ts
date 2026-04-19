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

interface ConnectorContext {
  operation: string;
  params: Record<string, unknown>;
  http: HttpApi;
  secrets: SecretsApi;
  base64Encode(input: string): string;
  base64Decode(input: string): string;
}

interface TestConnectionContext {
  http: HttpApi;
  secrets: SecretsApi;
  base64Encode(input: string): string;
  base64Decode(input: string): string;
}

// ─────────────────────────────────────────────────────────────────────────────

// Tavily Connector — open-web search + page extract optimised for LLM agents.
// Sandboxed environment; only HTTP + secrets are available.

const API_BASE = 'https://api.tavily.com';
const MAX_RESULTS_CAP = 5;
const MAX_EXTRACT_URLS = 5;
const MAX_RESULT_CONTENT_CHARS = 2000;

const connector = {
  operations: ['search', 'extract'],

  testConnection: function (ctx: TestConnectionContext) {
    const apiKey = ctx.secrets.get('apiKey');
    if (!apiKey) {
      throw new Error('Tavily API key is required.');
    }
    const response = ctx.http.post(API_BASE + '/search', {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TaleCorp-Connector/1.0',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: 'ping',
        max_results: 1,
        search_depth: 'basic',
      }),
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error('Tavily authentication failed. Verify the API key.');
    }
    if (response.status === 429) {
      throw new Error(
        'Tavily quota exceeded during connection test. Upgrade plan or try again later.',
      );
    }
    if (response.status !== 200) {
      throw new Error(
        'Tavily connection failed (' +
          response.status +
          '): ' +
          response.text(),
      );
    }
    return { status: 'ok' };
  },

  execute: function (ctx: ConnectorContext) {
    const apiKey = ctx.secrets.get('apiKey');
    if (!apiKey) {
      throw new Error('Tavily API key is required.');
    }
    if (ctx.operation === 'search') {
      return search(ctx.http, apiKey, ctx.params);
    }
    if (ctx.operation === 'extract') {
      return extractUrls(ctx.http, apiKey, ctx.params);
    }
    throw new Error('Unknown operation: ' + ctx.operation);
  },
};

function truncateToChars(text: string, max: number) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max) + '… [truncated]';
}

function handleHttpError(response: HttpResponse, operation: string) {
  if (response.status === 0) return;
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      'Tavily authentication failed during ' +
        operation +
        '. Verify the API key in Settings → Integrations → Tavily.',
    );
  }
  if (response.status === 429) {
    throw new Error(
      'Tavily rate limit or quota exceeded during ' +
        operation +
        '. Try again shortly or upgrade the plan.',
    );
  }
  if (response.status >= 500) {
    throw new Error(
      'Tavily API error during ' +
        operation +
        ' (' +
        response.status +
        '): ' +
        response.text(),
    );
  }
  if (response.status >= 400) {
    let body = '';
    try {
      const err = response.json();
      if (err && typeof err === 'object') {
        const rec: Record<string, unknown> = err;
        if (typeof rec.error === 'string') {
          body = rec.error;
        } else if (typeof rec.detail === 'string') {
          body = rec.detail;
        }
      }
      if (!body) body = response.text();
    } catch (e) {
      body = response.text();
    }
    throw new Error(
      'Tavily error during ' +
        operation +
        ' (' +
        response.status +
        '): ' +
        body,
    );
  }
}

function estimateSearchCostCents(params: Record<string, unknown>) {
  const depth = params['search_depth'];
  if (typeof depth === 'string' && depth.toLowerCase() === 'advanced') {
    return 5;
  }
  return 1;
}

function estimateExtractCostCents(urlCount: number) {
  return Math.max(1, urlCount) * 10;
}

function search(
  http: HttpApi,
  apiKey: string,
  params: Record<string, unknown>,
) {
  const query = params['query'];
  if (typeof query !== 'string' || query.length === 0) {
    throw new Error('search requires a non-empty "query" string.');
  }

  let maxResults = 5;
  if (typeof params['max_results'] === 'number') {
    maxResults = Math.max(
      1,
      Math.min(MAX_RESULTS_CAP, params['max_results'] as number),
    );
  }

  const payload: Record<string, unknown> = {
    api_key: apiKey,
    query: query,
    max_results: maxResults,
  };
  if (typeof params['search_depth'] === 'string') {
    payload.search_depth = params['search_depth'];
  }
  if (Array.isArray(params['include_domains'])) {
    payload.include_domains = params['include_domains'];
  }
  if (Array.isArray(params['exclude_domains'])) {
    payload.exclude_domains = params['exclude_domains'];
  }
  if (typeof params['include_answer'] === 'boolean') {
    payload.include_answer = params['include_answer'];
  }
  if (typeof params['topic'] === 'string') {
    payload.topic = params['topic'];
  }
  if (typeof params['days'] === 'number') {
    payload.days = params['days'];
  }

  const response = http.post(API_BASE + '/search', {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'TaleCorp-Connector/1.0',
    },
    body: JSON.stringify(payload),
  });
  if (response.status === 0) {
    return { success: true, operation: 'search', data: { pending: true } };
  }
  handleHttpError(response, 'search');

  const data = response.json();
  const rec: Record<string, unknown> =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const rawResults = Array.isArray(rec.results) ? rec.results : [];
  const trimmed = rawResults.slice(0, maxResults).map(function (r: unknown) {
    const item: Record<string, unknown> =
      r && typeof r === 'object' ? (r as Record<string, unknown>) : {};
    return {
      title: typeof item.title === 'string' ? item.title : '',
      url: typeof item.url === 'string' ? item.url : '',
      content: truncateToChars(
        typeof item.content === 'string' ? item.content : '',
        MAX_RESULT_CONTENT_CHARS,
      ),
      score: typeof item.score === 'number' ? item.score : undefined,
      published_date:
        typeof item.published_date === 'string'
          ? item.published_date
          : undefined,
    };
  });

  return {
    success: true,
    operation: 'search',
    data: {
      query: query,
      results: trimmed,
      answer: typeof rec.answer === 'string' ? rec.answer : undefined,
      response_time:
        typeof rec.response_time === 'number' ? rec.response_time : undefined,
    },
    count: trimmed.length,
    cost: { cents: estimateSearchCostCents(params) },
    timestamp: Date.now(),
  };
}

function extractUrls(
  http: HttpApi,
  apiKey: string,
  params: Record<string, unknown>,
) {
  const urlsRaw = params['urls'];
  if (!Array.isArray(urlsRaw) || urlsRaw.length === 0) {
    throw new Error('extract requires a non-empty "urls" array.');
  }
  const urls = urlsRaw
    .filter(function (u: unknown) {
      return typeof u === 'string' && u.length > 0;
    })
    .slice(0, MAX_EXTRACT_URLS);
  if (urls.length === 0) {
    throw new Error('extract requires at least one valid URL.');
  }

  const payload: Record<string, unknown> = {
    api_key: apiKey,
    urls: urls,
  };
  if (typeof params['extract_depth'] === 'string') {
    payload.extract_depth = params['extract_depth'];
  }

  const response = http.post(API_BASE + '/extract', {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'TaleCorp-Connector/1.0',
    },
    body: JSON.stringify(payload),
  });
  if (response.status === 0) {
    return { success: true, operation: 'extract', data: { pending: true } };
  }
  handleHttpError(response, 'extract');

  const data = response.json();
  const rec: Record<string, unknown> =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const rawItems = Array.isArray(rec.results) ? rec.results : [];
  const trimmed = rawItems.map(function (item: unknown) {
    const obj: Record<string, unknown> =
      item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    return {
      url: typeof obj.url === 'string' ? obj.url : '',
      raw_content: truncateToChars(
        typeof obj.raw_content === 'string' ? obj.raw_content : '',
        MAX_RESULT_CONTENT_CHARS * 3,
      ),
    };
  });

  return {
    success: true,
    operation: 'extract',
    data: {
      results: trimmed,
      failed_results: Array.isArray(rec.failed_results)
        ? rec.failed_results
        : [],
    },
    count: trimmed.length,
    cost: { cents: estimateExtractCostCents(urls.length) },
    timestamp: Date.now(),
  };
}
