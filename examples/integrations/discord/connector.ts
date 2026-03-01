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

// Discord Bot Connector - Discord API v10
// This connector runs in a sandboxed environment with controlled HTTP access

const API_BASE = 'https://discord.com/api/v10';

const connector = {
  operations: [
    'list_guilds',
    'get_guild',
    'list_channels',
    'list_messages',
    'send_message',
    'get_user',
    'list_members',
    'create_channel',
  ],

  testConnection: function (ctx: TestConnectionContext) {
    const accessToken = ctx.secrets.get('accessToken');
    if (!accessToken) {
      throw new Error('Discord bot token is required.');
    }

    const response = ctx.http.get(API_BASE + '/users/@me', {
      headers: {
        Authorization: 'Bot ' + accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 401) {
      throw new Error(
        'Authentication failed. Please verify your bot token is correct.',
      );
    }
    if (response.status === 403) {
      throw new Error(
        'Access denied. Please verify the bot has the required permissions.',
      );
    }
    if (response.status !== 200) {
      throw new Error(
        'Discord connection failed (' +
          response.status +
          '): ' +
          response.text(),
      );
    }

    const user = response.json();
    return {
      status: 'ok',
      username: user.username,
      discriminator: user.discriminator,
    };
  },

  execute: function (ctx: ConnectorContext) {
    const operation = ctx.operation;
    const params = ctx.params;
    const http = ctx.http;
    const secrets = ctx.secrets;

    const accessToken = secrets.get('accessToken');
    if (!accessToken) {
      throw new Error('Discord bot token is required.');
    }

    const headers = {
      Authorization: 'Bot ' + accessToken,
      'Content-Type': 'application/json',
    };

    if (operation === 'list_guilds') {
      return listGuilds(http, headers, params);
    }
    if (operation === 'get_guild') {
      return getGuild(http, headers, params);
    }
    if (operation === 'list_channels') {
      return listChannels(http, headers, params);
    }
    if (operation === 'list_messages') {
      return listMessages(http, headers, params);
    }
    if (operation === 'send_message') {
      return sendMessage(http, headers, params);
    }
    if (operation === 'get_user') {
      return getUser(http, headers, params);
    }
    if (operation === 'list_members') {
      return listMembers(http, headers, params);
    }
    if (operation === 'create_channel') {
      return createChannel(http, headers, params);
    }

    throw new Error('Unknown operation: ' + operation);
  },
};

function handleError(response: HttpResponse, operation: string) {
  if (response.status === 401) {
    throw new Error(
      'Authentication failed during ' +
        operation +
        '. Please verify your bot token.',
    );
  }
  if (response.status === 403) {
    throw new Error(
      'Permission denied during ' +
        operation +
        '. The bot may not have the required permissions.',
    );
  }
  if (response.status === 404) {
    throw new Error('Resource not found during ' + operation + '.');
  }
  if (response.status === 429) {
    throw new Error(
      'Rate limited by Discord during ' +
        operation +
        '. Please try again later.',
    );
  }
  if (response.status >= 400) {
    let errorBody = '';
    try {
      const err = response.json();
      errorBody = err.message || JSON.stringify(err);
    } catch (e) {
      errorBody = response.text();
    }
    throw new Error(
      'Discord API error during ' +
        operation +
        ' (' +
        response.status +
        '): ' +
        errorBody,
    );
  }
}

function listGuilds(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const limit = Math.min((params.limit as number) || 50, 200);
  const queryParts = ['limit=' + limit];
  if (params.before) {
    queryParts.push('before=' + params.before);
  }
  if (params.after) {
    queryParts.push('after=' + params.after);
  }

  const url = API_BASE + '/users/@me/guilds?' + queryParts.join('&');
  console.log('Fetching guilds from: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list_guilds');

  const guilds = response.json();
  return {
    success: true,
    operation: 'list_guilds',
    data: guilds,
    count: guilds.length,
    pagination: {
      hasNextPage: guilds.length >= limit,
      nextPageInfo: guilds.length > 0 ? guilds[guilds.length - 1].id : null,
    },
    timestamp: Date.now(),
  };
}

function getGuild(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.guild_id) {
    throw new Error('guild_id is required.');
  }

  const url = API_BASE + '/guilds/' + params.guild_id;
  console.log('Fetching guild: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'get_guild');

  const guild = response.json();
  return {
    success: true,
    operation: 'get_guild',
    data: guild,
    count: 1,
    timestamp: Date.now(),
  };
}

function listChannels(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.guild_id) {
    throw new Error('guild_id is required.');
  }

  const url = API_BASE + '/guilds/' + params.guild_id + '/channels';
  console.log('Fetching channels from: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list_channels');

  const channels = response.json();
  return {
    success: true,
    operation: 'list_channels',
    data: channels,
    count: channels.length,
    timestamp: Date.now(),
  };
}

function listMessages(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.channel_id) {
    throw new Error('channel_id is required.');
  }

  const limit = Math.min((params.limit as number) || 50, 100);
  const queryParts = ['limit=' + limit];
  if (params.before) {
    queryParts.push('before=' + params.before);
  }
  if (params.after) {
    queryParts.push('after=' + params.after);
  }
  if (params.around) {
    queryParts.push('around=' + params.around);
  }

  const url =
    API_BASE +
    '/channels/' +
    params.channel_id +
    '/messages?' +
    queryParts.join('&');
  console.log('Fetching messages from: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list_messages');

  const messages = response.json();
  return {
    success: true,
    operation: 'list_messages',
    data: messages,
    count: messages.length,
    pagination: {
      hasNextPage: messages.length >= limit,
      nextPageInfo:
        messages.length > 0 ? messages[messages.length - 1].id : null,
    },
    timestamp: Date.now(),
  };
}

function sendMessage(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.channel_id) {
    throw new Error('channel_id is required.');
  }
  if (!params.content) {
    throw new Error('content is required.');
  }

  const payload: Record<string, unknown> = { content: params.content };
  if (params.embeds) {
    if (typeof params.embeds === 'string') {
      try {
        payload.embeds = JSON.parse(params.embeds);
      } catch (e) {
        throw new Error('Invalid embeds JSON: ' + (e as Error).message);
      }
    } else {
      payload.embeds = params.embeds;
    }
  }

  const url = API_BASE + '/channels/' + params.channel_id + '/messages';
  console.log('Sending message to: ' + url);

  const response = http.post(url, {
    headers: headers,
    body: JSON.stringify(payload),
  });

  // status 0 = sandbox placeholder (HTTP not yet executed)
  if (response.status === 0) {
    return {
      success: true,
      operation: 'send_message',
      data: { pending: true },
    };
  }

  handleError(response, 'send_message');

  const message = response.json();
  return {
    success: true,
    operation: 'send_message',
    data: message,
    count: 1,
    timestamp: Date.now(),
  };
}

function getUser(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.user_id) {
    throw new Error('user_id is required.');
  }

  const url = API_BASE + '/users/' + params.user_id;
  console.log('Fetching user: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'get_user');

  const user = response.json();
  return {
    success: true,
    operation: 'get_user',
    data: user,
    count: 1,
    timestamp: Date.now(),
  };
}

function listMembers(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.guild_id) {
    throw new Error('guild_id is required.');
  }

  const limit = Math.min((params.limit as number) || 50, 1000);
  const queryParts = ['limit=' + limit];
  if (params.after) {
    queryParts.push('after=' + params.after);
  }

  const url =
    API_BASE +
    '/guilds/' +
    params.guild_id +
    '/members?' +
    queryParts.join('&');
  console.log('Fetching members from: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list_members');

  const members = response.json();
  return {
    success: true,
    operation: 'list_members',
    data: members,
    count: members.length,
    pagination: {
      hasNextPage: members.length >= limit,
      nextPageInfo:
        members.length > 0 ? members[members.length - 1].user?.id : null,
    },
    timestamp: Date.now(),
  };
}

function createChannel(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.guild_id) {
    throw new Error('guild_id is required.');
  }
  if (!params.name) {
    throw new Error('name is required.');
  }

  const payload: Record<string, unknown> = {
    name: params.name,
    type: params.type !== undefined ? Number(params.type) : 0,
  };
  if (params.topic) {
    payload.topic = params.topic;
  }

  const url = API_BASE + '/guilds/' + params.guild_id + '/channels';
  console.log('Creating channel in: ' + url);

  const response = http.post(url, {
    headers: headers,
    body: JSON.stringify(payload),
  });

  // status 0 = sandbox placeholder (HTTP not yet executed)
  if (response.status === 0) {
    return {
      success: true,
      operation: 'create_channel',
      data: { pending: true },
    };
  }

  handleError(response, 'create_channel');

  const channel = response.json();
  return {
    success: true,
    operation: 'create_channel',
    data: channel,
    count: 1,
    timestamp: Date.now(),
  };
}
