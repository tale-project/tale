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

// Slack Connector - Slack Web API
// This connector runs in a sandboxed environment with controlled HTTP access

const API_BASE = 'https://slack.com/api/';

const connector = {
  operations: [
    'list_channels',
    'get_channel',
    'list_messages',
    'send_message',
    'list_users',
    'get_user',
    'upload_file',
  ],

  testConnection: function (ctx: TestConnectionContext) {
    const accessToken = ctx.secrets.get('accessToken');

    if (!accessToken) {
      throw new Error(
        'Slack bot token is required. Please authorize via OAuth2.',
      );
    }

    const response = ctx.http.post(API_BASE + 'auth.test', {
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
    });

    handleError(response, 'auth test');
    const data = response.json();
    if (!data.ok) {
      throw new Error(
        'Slack authentication failed: ' + (data.error || 'unknown'),
      );
    }

    return {
      status: 'ok',
      team: data.team,
      user: data.user,
      teamId: data.team_id,
      userId: data.user_id,
    };
  },

  execute: function (ctx: ConnectorContext) {
    const operation = ctx.operation;
    const params = ctx.params;
    const http = ctx.http;
    const secrets = ctx.secrets;

    const accessToken = secrets.get('accessToken');
    if (!accessToken) {
      throw new Error('Slack bot token is required.');
    }

    const headers = {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
    };

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
    if (operation === 'list_users') {
      return listUsers(http, headers, params);
    }
    if (operation === 'get_user') {
      return getUser(http, headers, params);
    }
    if (operation === 'upload_file') {
      return uploadFile(http, headers, params);
    }

    throw new Error('Unknown operation: ' + operation);
  },
};

function handleSlackResponse(response: HttpResponse, operation: string) {
  handleError(response, operation);
  const data = response.json();
  if (!data.ok) {
    throw new Error(
      'Slack API error during ' +
        operation +
        ': ' +
        (data.error || 'unknown error'),
    );
  }
  return data;
}

function handleError(response: HttpResponse, operation: string) {
  if (response.status === 401) {
    throw new Error(
      'Authentication failed during ' +
        operation +
        '. The bot token may be expired or invalid. Please re-authorize.',
    );
  }
  if (response.status === 403) {
    throw new Error(
      'Permission denied during ' +
        operation +
        '. Please verify the bot has the required OAuth scopes.',
    );
  }
  if (response.status === 429) {
    throw new Error(
      'Rate limited by Slack during ' + operation + '. Please try again later.',
    );
  }
  if (response.status >= 400) {
    let errorBody = '';
    try {
      errorBody = response.text();
    } catch (e) {
      errorBody = 'unknown';
    }
    throw new Error(
      'Slack HTTP error during ' +
        operation +
        ' (' +
        response.status +
        '): ' +
        errorBody,
    );
  }
}

function listChannels(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const body: Record<string, unknown> = {
    limit: Math.min((params.limit || 100) as number, 200),
  };
  if (params.cursor) {
    body.cursor = params.cursor;
  }
  if (params.types) {
    body.types = params.types;
  }

  const response = http.post(API_BASE + 'conversations.list', {
    headers: headers,
    body: JSON.stringify(body),
  });
  const data = handleSlackResponse(response, 'list channels');

  return {
    success: true,
    operation: 'list_channels',
    data: data.channels,
    count: data.channels.length,
    pagination: {
      hasNextPage: !!(
        data.response_metadata && data.response_metadata.next_cursor
      ),
      nextPageInfo:
        (data.response_metadata && data.response_metadata.next_cursor) || null,
    },
    timestamp: Date.now(),
  };
}

function getChannel(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.channel) {
    throw new Error('channel (channel ID) is required.');
  }

  const response = http.post(API_BASE + 'conversations.info', {
    headers: {
      Authorization: headers.Authorization,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'channel=' + encodeURIComponent(params.channel as string),
  });
  const data = handleSlackResponse(response, 'get channel');

  return {
    success: true,
    operation: 'get_channel',
    data: data.channel,
    count: 1,
    timestamp: Date.now(),
  };
}

function listMessages(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.channel) {
    throw new Error('channel (channel ID) is required.');
  }

  const body: Record<string, unknown> = {
    channel: params.channel,
    limit: Math.min((params.limit || 50) as number, 200),
  };
  if (params.cursor) {
    body.cursor = params.cursor;
  }
  if (params.oldest) {
    body.oldest = String(params.oldest);
  }
  if (params.latest) {
    body.latest = String(params.latest);
  }

  const response = http.post(API_BASE + 'conversations.history', {
    headers: headers,
    body: JSON.stringify(body),
  });
  const data = handleSlackResponse(response, 'list messages');

  return {
    success: true,
    operation: 'list_messages',
    data: data.messages,
    count: data.messages.length,
    pagination: {
      hasNextPage: !!data.has_more,
      nextPageInfo:
        (data.response_metadata && data.response_metadata.next_cursor) || null,
    },
    timestamp: Date.now(),
  };
}

function sendMessage(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.channel) {
    throw new Error('channel (channel ID) is required.');
  }
  if (!params.text) {
    throw new Error('text (message text) is required.');
  }

  const payload: Record<string, unknown> = {
    channel: params.channel,
    text: params.text,
  };
  if (params.blocks) {
    payload.blocks =
      typeof params.blocks === 'string'
        ? JSON.parse(params.blocks)
        : params.blocks;
  }
  if (params.thread_ts) {
    payload.thread_ts = params.thread_ts;
  }

  const response = http.post(API_BASE + 'chat.postMessage', {
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
  const data = handleSlackResponse(response, 'send message');

  return {
    success: true,
    operation: 'send_message',
    data: {
      channel: data.channel,
      ts: data.ts,
      message: data.message,
    },
    count: 1,
    timestamp: Date.now(),
  };
}

function listUsers(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const body: Record<string, unknown> = {
    limit: Math.min((params.limit || 100) as number, 200),
  };
  if (params.cursor) {
    body.cursor = params.cursor;
  }

  const response = http.post(API_BASE + 'users.list', {
    headers: headers,
    body: JSON.stringify(body),
  });
  const data = handleSlackResponse(response, 'list users');

  return {
    success: true,
    operation: 'list_users',
    data: data.members,
    count: data.members.length,
    pagination: {
      hasNextPage: !!(
        data.response_metadata && data.response_metadata.next_cursor
      ),
      nextPageInfo:
        (data.response_metadata && data.response_metadata.next_cursor) || null,
    },
    timestamp: Date.now(),
  };
}

function getUser(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.user) {
    throw new Error('user (user ID) is required.');
  }

  const response = http.post(API_BASE + 'users.info', {
    headers: {
      Authorization: headers.Authorization,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'user=' + encodeURIComponent(params.user as string),
  });
  const data = handleSlackResponse(response, 'get user');

  return {
    success: true,
    operation: 'get_user',
    data: data.user,
    count: 1,
    timestamp: Date.now(),
  };
}

function uploadFile(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.channels) {
    throw new Error('channels (comma-separated channel IDs) is required.');
  }
  if (!params.content) {
    throw new Error('content (file content) is required.');
  }

  const filename = (params.filename || 'file.txt') as string;
  const contentLength = (params.content as string).length;

  const urlResponse = http.post(API_BASE + 'files.getUploadURLExternal', {
    headers: {
      Authorization: headers.Authorization,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body:
      'filename=' + encodeURIComponent(filename) + '&length=' + contentLength,
  });
  const urlData = handleSlackResponse(urlResponse, 'get upload URL');

  const uploadResponse = http.post(urlData.upload_url, {
    headers: { 'Content-Type': 'text/plain' },
    body: params.content as string,
  });
  handleError(uploadResponse, 'upload file content');

  const channelList = (params.channels as string).split(',').map(function (ch) {
    return ch.trim();
  });
  const files: Record<string, unknown>[] = [{ id: urlData.file_id }];
  if (params.title) {
    files[0].title = params.title;
  }

  const completeBody: Record<string, unknown> = {
    files: files,
    channel_id: channelList[0],
  };
  if (params.initial_comment) {
    completeBody.initial_comment = params.initial_comment;
  }

  const completeResponse = http.post(
    API_BASE + 'files.completeUploadExternal',
    {
      headers: headers,
      body: JSON.stringify(completeBody),
    },
  );
  if (completeResponse.status === 0) {
    return {
      success: true,
      operation: 'upload_file',
      data: { pending: true },
    };
  }
  const completeData = handleSlackResponse(completeResponse, 'complete upload');

  const fileInfo =
    completeData.files && completeData.files[0] ? completeData.files[0] : {};

  return {
    success: true,
    operation: 'upload_file',
    data: {
      id: fileInfo.id || urlData.file_id,
      name: fileInfo.name || filename,
      title: fileInfo.title || params.title || filename,
    },
    count: 1,
    timestamp: Date.now(),
  };
}
