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

// GitHub Connector - Fetch data from GitHub REST API
// This connector runs in a sandboxed environment with controlled HTTP access

const API_BASE = 'https://api.github.com';

const connector = {
  operations: [
    'list_repos',
    'get_repo',
    'list_issues',
    'get_issue',
    'create_issue',
    'list_pull_requests',
    'get_pull_request',
    'create_pull_request',
    'list_commits',
    'search_code',
  ],

  testConnection: function (ctx: TestConnectionContext) {
    const accessToken = ctx.secrets.get('accessToken');
    if (!accessToken) {
      throw new Error('GitHub access token is required.');
    }

    const response = ctx.http.get(API_BASE + '/user', {
      headers: {
        Authorization: 'Bearer ' + accessToken,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'TaleCorp-Connector/1.0',
      },
    });

    if (response.status === 401) {
      throw new Error(
        'GitHub authentication failed. Please verify your personal access token is correct.',
      );
    }
    if (response.status === 403) {
      throw new Error(
        'GitHub access denied. Please verify the token has the required scopes.',
      );
    }
    if (response.status !== 200) {
      throw new Error(
        'GitHub connection failed (' +
          response.status +
          '): ' +
          response.text(),
      );
    }

    const user = response.json();
    return { status: 'ok', login: user.login };
  },

  execute: function (ctx: ConnectorContext) {
    const operation = ctx.operation;
    const params = ctx.params;
    const http = ctx.http;
    const secrets = ctx.secrets;

    const accessToken = secrets.get('accessToken');
    if (!accessToken) {
      throw new Error('GitHub access token is required.');
    }

    const headers = {
      Authorization: 'Bearer ' + accessToken,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'TaleCorp-Connector/1.0',
    };

    if (operation === 'list_repos') return listRepos(http, headers, params);
    if (operation === 'get_repo') return getRepo(http, headers, params);
    if (operation === 'list_issues') return listIssues(http, headers, params);
    if (operation === 'get_issue') return getIssue(http, headers, params);
    if (operation === 'create_issue') return createIssue(http, headers, params);
    if (operation === 'list_pull_requests')
      return listPullRequests(http, headers, params);
    if (operation === 'get_pull_request')
      return getPullRequest(http, headers, params);
    if (operation === 'create_pull_request')
      return createPullRequest(http, headers, params);
    if (operation === 'list_commits') return listCommits(http, headers, params);
    if (operation === 'search_code') return searchCode(http, headers, params);

    throw new Error('Unknown operation: ' + operation);
  },
};

function handleError(response: HttpResponse, operation: string) {
  if (response.status === 401) {
    throw new Error(
      'Authentication failed during ' +
        operation +
        '. Please verify your access token.',
    );
  }
  if (response.status === 403) {
    throw new Error(
      'Permission denied during ' +
        operation +
        '. Please verify the token has the required scopes.',
    );
  }
  if (response.status === 404) {
    throw new Error('Resource not found during ' + operation + '.');
  }
  if (response.status === 422) {
    let validationBody = '';
    try {
      const err = response.json();
      validationBody = err.message || response.text();
      if (err.errors && err.errors.length > 0) {
        const details = err.errors
          .map(function (e: { field: string; message: string }) {
            return e.field + ': ' + e.message;
          })
          .join(', ');
        validationBody = validationBody + ' (' + details + ')';
      }
    } catch (e) {
      validationBody = response.text();
    }
    throw new Error(
      'Validation error during ' + operation + ': ' + validationBody,
    );
  }
  if (response.status === 429) {
    throw new Error(
      'Rate limited during ' + operation + '. Please try again later.',
    );
  }
  if (response.status >= 400) {
    let errorBody = '';
    try {
      const errData = response.json();
      errorBody = errData.message || response.text();
    } catch (e) {
      errorBody = response.text();
    }
    throw new Error(
      'GitHub API error during ' +
        operation +
        ' (' +
        response.status +
        '): ' +
        errorBody,
    );
  }
}

function extractPagination(response: HttpResponse) {
  const linkHeader = response.headers['link'] || response.headers['Link'] || '';
  let hasNextPage = false;
  let nextPage: string | null = null;
  if (linkHeader) {
    const links = linkHeader.split(',');
    for (let i = 0; i < links.length; i++) {
      if (links[i].indexOf('rel="next"') !== -1) {
        const match = links[i].match(/[?&]page=(\d+)/);
        if (match) {
          nextPage = match[1];
          hasNextPage = true;
        }
      }
    }
  }
  return { hasNextPage: hasNextPage, nextPageInfo: nextPage };
}

function buildQueryString(
  params: Record<string, unknown>,
  allowedKeys: string[],
) {
  const parts: string[] = [];
  for (let i = 0; i < allowedKeys.length; i++) {
    const key = allowedKeys[i];
    if (
      params[key] !== undefined &&
      params[key] !== null &&
      params[key] !== ''
    ) {
      parts.push(
        encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key])),
      );
    }
  }
  return parts.length > 0 ? '?' + parts.join('&') : '';
}

function requireParam(
  params: Record<string, unknown>,
  name: string,
  operation: string,
) {
  if (!params[name]) {
    throw new Error(name + ' is required for ' + operation + '.');
  }
  return params[name];
}

function listRepos(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const qs = buildQueryString(params, [
    'per_page',
    'page',
    'sort',
    'visibility',
  ]);
  const url = API_BASE + '/user/repos' + qs;
  console.log('Fetching repos from: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list_repos');

  const repos = response.json();
  return {
    success: true,
    operation: 'list_repos',
    data: repos,
    count: repos.length,
    pagination: extractPagination(response),
    timestamp: Date.now(),
  };
}

function getRepo(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const owner = requireParam(params, 'owner', 'get_repo');
  const repo = requireParam(params, 'repo', 'get_repo');

  const url =
    API_BASE +
    '/repos/' +
    encodeURIComponent(String(owner)) +
    '/' +
    encodeURIComponent(String(repo));
  console.log('Fetching repo: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'get_repo');

  return {
    success: true,
    operation: 'get_repo',
    data: response.json(),
    count: 1,
    timestamp: Date.now(),
  };
}

function listIssues(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const owner = requireParam(params, 'owner', 'list_issues');
  const repo = requireParam(params, 'repo', 'list_issues');

  const qs = buildQueryString(params, [
    'state',
    'per_page',
    'page',
    'labels',
    'sort',
    'direction',
  ]);
  const url =
    API_BASE +
    '/repos/' +
    encodeURIComponent(String(owner)) +
    '/' +
    encodeURIComponent(String(repo)) +
    '/issues' +
    qs;
  console.log('Fetching issues from: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list_issues');

  const issues = response.json();
  return {
    success: true,
    operation: 'list_issues',
    data: issues,
    count: issues.length,
    pagination: extractPagination(response),
    timestamp: Date.now(),
  };
}

function getIssue(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const owner = requireParam(params, 'owner', 'get_issue');
  const repo = requireParam(params, 'repo', 'get_issue');
  const issueNumber = requireParam(params, 'issue_number', 'get_issue');

  const url =
    API_BASE +
    '/repos/' +
    encodeURIComponent(String(owner)) +
    '/' +
    encodeURIComponent(String(repo)) +
    '/issues/' +
    encodeURIComponent(String(issueNumber));
  console.log('Fetching issue: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'get_issue');

  return {
    success: true,
    operation: 'get_issue',
    data: response.json(),
    count: 1,
    timestamp: Date.now(),
  };
}

function createIssue(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const owner = requireParam(params, 'owner', 'create_issue');
  const repo = requireParam(params, 'repo', 'create_issue');
  const title = requireParam(params, 'title', 'create_issue');

  const payload: Record<string, unknown> = { title: title };
  if (params.body) payload.body = params.body;
  if (params.labels) payload.labels = params.labels;
  if (params.assignees) payload.assignees = params.assignees;

  const url =
    API_BASE +
    '/repos/' +
    encodeURIComponent(String(owner)) +
    '/' +
    encodeURIComponent(String(repo)) +
    '/issues';
  console.log('Creating issue at: ' + url);

  const response = http.post(url, {
    headers: headers,
    body: JSON.stringify(payload),
  });
  if (response.status === 0) {
    return {
      success: true,
      operation: 'create_issue',
      data: { pending: true },
    };
  }
  handleError(response, 'create_issue');

  return {
    success: true,
    operation: 'create_issue',
    data: response.json(),
    count: 1,
    timestamp: Date.now(),
  };
}

function listPullRequests(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const owner = requireParam(params, 'owner', 'list_pull_requests');
  const repo = requireParam(params, 'repo', 'list_pull_requests');

  const qs = buildQueryString(params, [
    'state',
    'per_page',
    'page',
    'sort',
    'direction',
  ]);
  const url =
    API_BASE +
    '/repos/' +
    encodeURIComponent(String(owner)) +
    '/' +
    encodeURIComponent(String(repo)) +
    '/pulls' +
    qs;
  console.log('Fetching pull requests from: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list_pull_requests');

  const pulls = response.json();
  return {
    success: true,
    operation: 'list_pull_requests',
    data: pulls,
    count: pulls.length,
    pagination: extractPagination(response),
    timestamp: Date.now(),
  };
}

function getPullRequest(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const owner = requireParam(params, 'owner', 'get_pull_request');
  const repo = requireParam(params, 'repo', 'get_pull_request');
  const pullNumber = requireParam(params, 'pull_number', 'get_pull_request');

  const url =
    API_BASE +
    '/repos/' +
    encodeURIComponent(String(owner)) +
    '/' +
    encodeURIComponent(String(repo)) +
    '/pulls/' +
    encodeURIComponent(String(pullNumber));
  console.log('Fetching pull request: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'get_pull_request');

  return {
    success: true,
    operation: 'get_pull_request',
    data: response.json(),
    count: 1,
    timestamp: Date.now(),
  };
}

function createPullRequest(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const owner = requireParam(params, 'owner', 'create_pull_request');
  const repo = requireParam(params, 'repo', 'create_pull_request');
  const title = requireParam(params, 'title', 'create_pull_request');
  const head = requireParam(params, 'head', 'create_pull_request');
  const base = requireParam(params, 'base', 'create_pull_request');

  const payload: Record<string, unknown> = {
    title: title,
    head: head,
    base: base,
  };
  if (params.body) payload.body = params.body;

  const url =
    API_BASE +
    '/repos/' +
    encodeURIComponent(String(owner)) +
    '/' +
    encodeURIComponent(String(repo)) +
    '/pulls';
  console.log('Creating pull request at: ' + url);

  const response = http.post(url, {
    headers: headers,
    body: JSON.stringify(payload),
  });
  if (response.status === 0) {
    return {
      success: true,
      operation: 'create_pull_request',
      data: { pending: true },
    };
  }
  handleError(response, 'create_pull_request');

  return {
    success: true,
    operation: 'create_pull_request',
    data: response.json(),
    count: 1,
    timestamp: Date.now(),
  };
}

function listCommits(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const owner = requireParam(params, 'owner', 'list_commits');
  const repo = requireParam(params, 'repo', 'list_commits');

  const qs = buildQueryString(params, ['per_page', 'page', 'sha']);
  const url =
    API_BASE +
    '/repos/' +
    encodeURIComponent(String(owner)) +
    '/' +
    encodeURIComponent(String(repo)) +
    '/commits' +
    qs;
  console.log('Fetching commits from: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list_commits');

  const commits = response.json();
  return {
    success: true,
    operation: 'list_commits',
    data: commits,
    count: commits.length,
    pagination: extractPagination(response),
    timestamp: Date.now(),
  };
}

function searchCode(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const q = requireParam(params, 'q', 'search_code');

  const queryParts = ['q=' + encodeURIComponent(String(q))];
  if (params.per_page)
    queryParts.push('per_page=' + encodeURIComponent(String(params.per_page)));
  if (params.page)
    queryParts.push('page=' + encodeURIComponent(String(params.page)));

  const url = API_BASE + '/search/code?' + queryParts.join('&');
  console.log('Searching code: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'search_code');

  const data = response.json();
  return {
    success: true,
    operation: 'search_code',
    data: data.items,
    count: data.items.length,
    totalCount: data.total_count,
    pagination: extractPagination(response),
    timestamp: Date.now(),
  };
}
