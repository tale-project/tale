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

// Microsoft Teams Connector - Microsoft Graph API
// This connector runs in a sandboxed environment with controlled HTTP access

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

const connector = {
  operations: [
    'list_teams',
    'get_team',
    'list_channels',
    'get_channel',
    'list_messages',
    'send_message',
    'list_members',
    'list_chats',
    'send_chat_message',
  ],

  testConnection: function (ctx: TestConnectionContext) {
    const accessToken = ctx.secrets.get('accessToken');

    if (!accessToken) {
      throw new Error('Access token is required. Please authorize via OAuth2.');
    }

    const response = ctx.http.get(GRAPH_BASE_URL + '/me', {
      headers: {
        Authorization: 'Bearer ' + accessToken,
        Accept: 'application/json',
      },
    });

    if (response.status === 401) {
      throw new Error(
        'Authentication failed. The access token may be expired or invalid. Please re-authorize.',
      );
    }
    if (response.status === 403) {
      throw new Error(
        'Access denied. Please verify the app has the required Microsoft Graph permissions.',
      );
    }
    if (response.status !== 200) {
      throw new Error(
        'Microsoft Graph connection failed (' +
          response.status +
          '): ' +
          response.text(),
      );
    }

    const user = response.json();
    return {
      status: 'ok',
      displayName: user.displayName,
      email: user.mail || user.userPrincipalName,
    };
  },

  execute: function (ctx: ConnectorContext) {
    const operation = ctx.operation;
    const params = ctx.params;
    const http = ctx.http;
    const secrets = ctx.secrets;

    const accessToken = secrets.get('accessToken');
    if (!accessToken) {
      throw new Error('Access token is required.');
    }

    const headers = {
      Authorization: 'Bearer ' + accessToken,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    if (operation === 'list_teams') {
      return listTeams(http, headers, params);
    }
    if (operation === 'get_team') {
      return getTeam(http, headers, params);
    }
    if (operation === 'list_channels') {
      return listChannels(http, headers, params);
    }
    if (operation === 'get_channel') {
      return getChannel(http, headers, params);
    }
    if (operation === 'list_messages') {
      return listMessages(http, headers, params);
    }
    if (operation === 'send_message') {
      return sendMessage(http, headers, params);
    }
    if (operation === 'list_members') {
      return listMembers(http, headers, params);
    }
    if (operation === 'list_chats') {
      return listChats(http, headers, params);
    }
    if (operation === 'send_chat_message') {
      return sendChatMessage(http, headers, params);
    }

    throw new Error('Unknown operation: ' + operation);
  },
};

function handleError(response: HttpResponse, operation: string) {
  if (response.status === 401) {
    throw new Error(
      'Authentication failed during ' +
        operation +
        '. The access token may be expired. Please re-authorize.',
    );
  }
  if (response.status === 403) {
    throw new Error(
      'Permission denied during ' +
        operation +
        '. Please verify the app has the required Microsoft Graph scopes.',
    );
  }
  if (response.status === 404) {
    throw new Error('Resource not found during ' + operation + '.');
  }
  if (response.status === 429) {
    throw new Error(
      'Rate limited by Microsoft Graph during ' +
        operation +
        '. Please try again later.',
    );
  }
  if (response.status >= 400) {
    let errorBody = '';
    try {
      const err = response.json();
      errorBody = err.error ? err.error.message : response.text();
    } catch (e) {
      errorBody = response.text();
    }
    throw new Error(
      'Microsoft Graph error during ' +
        operation +
        ' (' +
        response.status +
        '): ' +
        errorBody,
    );
  }
}

function listTeams(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const url = GRAPH_BASE_URL + '/me/joinedTeams';
  console.log('Fetching teams from: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list teams');

  const data = response.json();
  return {
    success: true,
    operation: 'list_teams',
    data: data.value,
    count: data.value.length,
    pagination: {
      hasNextPage: !!data['@odata.nextLink'],
      nextLink: data['@odata.nextLink'] || null,
    },
    timestamp: Date.now(),
  };
}

function getTeam(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.teamId) {
    throw new Error('teamId is required.');
  }

  const url = GRAPH_BASE_URL + '/teams/' + params.teamId;
  console.log('Fetching team: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'get team');

  const team = response.json();
  return {
    success: true,
    operation: 'get_team',
    data: team,
    count: 1,
    timestamp: Date.now(),
  };
}

function listChannels(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.teamId) {
    throw new Error('teamId is required.');
  }

  const url = GRAPH_BASE_URL + '/teams/' + params.teamId + '/channels';
  console.log('Fetching channels from: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list channels');

  const data = response.json();
  return {
    success: true,
    operation: 'list_channels',
    data: data.value,
    count: data.value.length,
    pagination: {
      hasNextPage: !!data['@odata.nextLink'],
      nextLink: data['@odata.nextLink'] || null,
    },
    timestamp: Date.now(),
  };
}

function getChannel(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.teamId) {
    throw new Error('teamId is required.');
  }
  if (!params.channelId) {
    throw new Error('channelId is required.');
  }

  const url =
    GRAPH_BASE_URL +
    '/teams/' +
    params.teamId +
    '/channels/' +
    params.channelId;
  console.log('Fetching channel: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'get channel');

  const channel = response.json();
  return {
    success: true,
    operation: 'get_channel',
    data: channel,
    count: 1,
    timestamp: Date.now(),
  };
}

function listMessages(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.teamId) {
    throw new Error('teamId is required.');
  }
  if (!params.channelId) {
    throw new Error('channelId is required.');
  }

  const top = Math.min((params.top || 20) as number, 50);
  const queryParts = ['$top=' + top];

  const url =
    GRAPH_BASE_URL +
    '/teams/' +
    params.teamId +
    '/channels/' +
    params.channelId +
    '/messages?' +
    queryParts.join('&');
  console.log('Fetching messages from: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list messages');

  const data = response.json();
  return {
    success: true,
    operation: 'list_messages',
    data: data.value,
    count: data.value.length,
    pagination: {
      hasNextPage: !!data['@odata.nextLink'],
      nextLink: data['@odata.nextLink'] || null,
    },
    timestamp: Date.now(),
  };
}

function sendMessage(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.teamId) {
    throw new Error('teamId is required.');
  }
  if (!params.channelId) {
    throw new Error('channelId is required.');
  }
  if (!params.content) {
    throw new Error('content is required.');
  }

  const url =
    GRAPH_BASE_URL +
    '/teams/' +
    params.teamId +
    '/channels/' +
    params.channelId +
    '/messages';
  const payload = {
    body: {
      content: params.content,
      contentType: (params.contentType || 'text') as string,
    },
  };

  console.log('Sending message to: ' + url);

  const response = http.post(url, {
    headers: headers,
    body: JSON.stringify(payload),
  });

  if (response.status === 0) {
    return {
      success: true,
      operation: 'send_message',
      data: { pending: true },
    };
  }

  handleError(response, 'send message');

  const message = response.json();
  return {
    success: true,
    operation: 'send_message',
    data: message,
    count: 1,
    timestamp: Date.now(),
  };
}

function listMembers(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.teamId) {
    throw new Error('teamId is required.');
  }

  const top = (params.top || 100) as number;
  const queryParts = ['$top=' + top];
  if (params.skip) {
    queryParts.push('$skip=' + params.skip);
  }

  const url =
    GRAPH_BASE_URL +
    '/teams/' +
    params.teamId +
    '/members?' +
    queryParts.join('&');
  console.log('Fetching members from: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list members');

  const data = response.json();
  return {
    success: true,
    operation: 'list_members',
    data: data.value,
    count: data.value.length,
    pagination: {
      hasNextPage: !!data['@odata.nextLink'],
      nextLink: data['@odata.nextLink'] || null,
    },
    timestamp: Date.now(),
  };
}

function listChats(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const top = Math.min((params.top || 20) as number, 50);
  const url = GRAPH_BASE_URL + '/me/chats?$top=' + top;
  console.log('Fetching chats from: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list chats');

  const data = response.json();
  return {
    success: true,
    operation: 'list_chats',
    data: data.value,
    count: data.value.length,
    pagination: {
      hasNextPage: !!data['@odata.nextLink'],
      nextLink: data['@odata.nextLink'] || null,
    },
    timestamp: Date.now(),
  };
}

function sendChatMessage(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.chatId) {
    throw new Error('chatId is required.');
  }
  if (!params.content) {
    throw new Error('content is required.');
  }

  const url = GRAPH_BASE_URL + '/chats/' + params.chatId + '/messages';
  const payload = {
    body: {
      content: params.content,
      contentType: (params.contentType || 'text') as string,
    },
  };

  console.log('Sending chat message to: ' + url);

  const response = http.post(url, {
    headers: headers,
    body: JSON.stringify(payload),
  });

  if (response.status === 0) {
    return {
      success: true,
      operation: 'send_chat_message',
      data: { pending: true },
    };
  }

  handleError(response, 'send chat message');

  const message = response.json();
  return {
    success: true,
    operation: 'send_chat_message',
    data: message,
    count: 1,
    timestamp: Date.now(),
  };
}
