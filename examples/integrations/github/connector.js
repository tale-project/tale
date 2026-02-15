// GitHub Connector - Fetch data from GitHub REST API
// This connector runs in a sandboxed environment with controlled HTTP access

var API_BASE = 'https://api.github.com';

var connector = {
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

  testConnection: function (ctx) {
    var accessToken = ctx.secrets.get('accessToken');
    if (!accessToken) {
      throw new Error('GitHub access token is required.');
    }

    var response = ctx.http.get(API_BASE + '/user', {
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

    var user = response.json();
    return { status: 'ok', login: user.login };
  },

  execute: function (ctx) {
    var operation = ctx.operation;
    var params = ctx.params;
    var http = ctx.http;
    var secrets = ctx.secrets;

    var accessToken = secrets.get('accessToken');
    if (!accessToken) {
      throw new Error('GitHub access token is required.');
    }

    var headers = {
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

function handleError(response, operation) {
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
    var validationBody = '';
    try {
      var err = response.json();
      validationBody = err.message || response.text();
      if (err.errors && err.errors.length > 0) {
        var details = err.errors
          .map(function (e) {
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
    var errorBody = '';
    try {
      var errData = response.json();
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

function extractPagination(response) {
  var linkHeader = response.headers['link'] || response.headers['Link'] || '';
  var hasNextPage = false;
  var nextPage = null;
  if (linkHeader) {
    var links = linkHeader.split(',');
    for (var i = 0; i < links.length; i++) {
      if (links[i].indexOf('rel="next"') !== -1) {
        var match = links[i].match(/[?&]page=(\d+)/);
        if (match) {
          nextPage = match[1];
          hasNextPage = true;
        }
      }
    }
  }
  return { hasNextPage: hasNextPage, nextPageInfo: nextPage };
}

function buildQueryString(params, allowedKeys) {
  var parts = [];
  for (var i = 0; i < allowedKeys.length; i++) {
    var key = allowedKeys[i];
    if (
      params[key] !== undefined &&
      params[key] !== null &&
      params[key] !== ''
    ) {
      parts.push(
        encodeURIComponent(key) + '=' + encodeURIComponent(params[key]),
      );
    }
  }
  return parts.length > 0 ? '?' + parts.join('&') : '';
}

function requireParam(params, name, operation) {
  if (!params[name]) {
    throw new Error(name + ' is required for ' + operation + '.');
  }
  return params[name];
}

function listRepos(http, headers, params) {
  var qs = buildQueryString(params, ['per_page', 'page', 'sort', 'visibility']);
  var url = API_BASE + '/user/repos' + qs;
  console.log('Fetching repos from: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list_repos');

  var repos = response.json();
  return {
    success: true,
    operation: 'list_repos',
    data: repos,
    count: repos.length,
    pagination: extractPagination(response),
    timestamp: Date.now(),
  };
}

function getRepo(http, headers, params) {
  var owner = requireParam(params, 'owner', 'get_repo');
  var repo = requireParam(params, 'repo', 'get_repo');

  var url =
    API_BASE +
    '/repos/' +
    encodeURIComponent(owner) +
    '/' +
    encodeURIComponent(repo);
  console.log('Fetching repo: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'get_repo');

  return {
    success: true,
    operation: 'get_repo',
    data: response.json(),
    count: 1,
    timestamp: Date.now(),
  };
}

function listIssues(http, headers, params) {
  var owner = requireParam(params, 'owner', 'list_issues');
  var repo = requireParam(params, 'repo', 'list_issues');

  var qs = buildQueryString(params, [
    'state',
    'per_page',
    'page',
    'labels',
    'sort',
    'direction',
  ]);
  var url =
    API_BASE +
    '/repos/' +
    encodeURIComponent(owner) +
    '/' +
    encodeURIComponent(repo) +
    '/issues' +
    qs;
  console.log('Fetching issues from: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list_issues');

  var issues = response.json();
  return {
    success: true,
    operation: 'list_issues',
    data: issues,
    count: issues.length,
    pagination: extractPagination(response),
    timestamp: Date.now(),
  };
}

function getIssue(http, headers, params) {
  var owner = requireParam(params, 'owner', 'get_issue');
  var repo = requireParam(params, 'repo', 'get_issue');
  var issueNumber = requireParam(params, 'issue_number', 'get_issue');

  var url =
    API_BASE +
    '/repos/' +
    encodeURIComponent(owner) +
    '/' +
    encodeURIComponent(repo) +
    '/issues/' +
    encodeURIComponent(issueNumber);
  console.log('Fetching issue: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'get_issue');

  return {
    success: true,
    operation: 'get_issue',
    data: response.json(),
    count: 1,
    timestamp: Date.now(),
  };
}

function createIssue(http, headers, params) {
  var owner = requireParam(params, 'owner', 'create_issue');
  var repo = requireParam(params, 'repo', 'create_issue');
  var title = requireParam(params, 'title', 'create_issue');

  var payload = { title: title };
  if (params.body) payload.body = params.body;
  if (params.labels) payload.labels = params.labels;
  if (params.assignees) payload.assignees = params.assignees;

  var url =
    API_BASE +
    '/repos/' +
    encodeURIComponent(owner) +
    '/' +
    encodeURIComponent(repo) +
    '/issues';
  console.log('Creating issue at: ' + url);

  var response = http.post(url, {
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

function listPullRequests(http, headers, params) {
  var owner = requireParam(params, 'owner', 'list_pull_requests');
  var repo = requireParam(params, 'repo', 'list_pull_requests');

  var qs = buildQueryString(params, [
    'state',
    'per_page',
    'page',
    'sort',
    'direction',
  ]);
  var url =
    API_BASE +
    '/repos/' +
    encodeURIComponent(owner) +
    '/' +
    encodeURIComponent(repo) +
    '/pulls' +
    qs;
  console.log('Fetching pull requests from: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list_pull_requests');

  var pulls = response.json();
  return {
    success: true,
    operation: 'list_pull_requests',
    data: pulls,
    count: pulls.length,
    pagination: extractPagination(response),
    timestamp: Date.now(),
  };
}

function getPullRequest(http, headers, params) {
  var owner = requireParam(params, 'owner', 'get_pull_request');
  var repo = requireParam(params, 'repo', 'get_pull_request');
  var pullNumber = requireParam(params, 'pull_number', 'get_pull_request');

  var url =
    API_BASE +
    '/repos/' +
    encodeURIComponent(owner) +
    '/' +
    encodeURIComponent(repo) +
    '/pulls/' +
    encodeURIComponent(pullNumber);
  console.log('Fetching pull request: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'get_pull_request');

  return {
    success: true,
    operation: 'get_pull_request',
    data: response.json(),
    count: 1,
    timestamp: Date.now(),
  };
}

function createPullRequest(http, headers, params) {
  var owner = requireParam(params, 'owner', 'create_pull_request');
  var repo = requireParam(params, 'repo', 'create_pull_request');
  var title = requireParam(params, 'title', 'create_pull_request');
  var head = requireParam(params, 'head', 'create_pull_request');
  var base = requireParam(params, 'base', 'create_pull_request');

  var payload = { title: title, head: head, base: base };
  if (params.body) payload.body = params.body;

  var url =
    API_BASE +
    '/repos/' +
    encodeURIComponent(owner) +
    '/' +
    encodeURIComponent(repo) +
    '/pulls';
  console.log('Creating pull request at: ' + url);

  var response = http.post(url, {
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

function listCommits(http, headers, params) {
  var owner = requireParam(params, 'owner', 'list_commits');
  var repo = requireParam(params, 'repo', 'list_commits');

  var qs = buildQueryString(params, ['per_page', 'page', 'sha']);
  var url =
    API_BASE +
    '/repos/' +
    encodeURIComponent(owner) +
    '/' +
    encodeURIComponent(repo) +
    '/commits' +
    qs;
  console.log('Fetching commits from: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list_commits');

  var commits = response.json();
  return {
    success: true,
    operation: 'list_commits',
    data: commits,
    count: commits.length,
    pagination: extractPagination(response),
    timestamp: Date.now(),
  };
}

function searchCode(http, headers, params) {
  var q = requireParam(params, 'q', 'search_code');

  var queryParts = ['q=' + encodeURIComponent(q)];
  if (params.per_page)
    queryParts.push('per_page=' + encodeURIComponent(params.per_page));
  if (params.page) queryParts.push('page=' + encodeURIComponent(params.page));

  var url = API_BASE + '/search/code?' + queryParts.join('&');
  console.log('Searching code: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'search_code');

  var data = response.json();
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
