// Discord Bot Connector - Discord API v10
// This connector runs in a sandboxed environment with controlled HTTP access

var API_BASE = 'https://discord.com/api/v10';

var connector = {
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

  testConnection: function (ctx) {
    var accessToken = ctx.secrets.get('accessToken');
    if (!accessToken) {
      throw new Error('Discord bot token is required.');
    }

    var response = ctx.http.get(API_BASE + '/users/@me', {
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

    var user = response.json();
    return {
      status: 'ok',
      username: user.username,
      discriminator: user.discriminator,
    };
  },

  execute: function (ctx) {
    var operation = ctx.operation;
    var params = ctx.params;
    var http = ctx.http;
    var secrets = ctx.secrets;

    var accessToken = secrets.get('accessToken');
    if (!accessToken) {
      throw new Error('Discord bot token is required.');
    }

    var headers = {
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

function handleError(response, operation) {
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
    var errorBody = '';
    try {
      var err = response.json();
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

function listGuilds(http, headers, params) {
  var limit = Math.min(params.limit || 50, 200);
  var queryParts = ['limit=' + limit];
  if (params.before) {
    queryParts.push('before=' + params.before);
  }
  if (params.after) {
    queryParts.push('after=' + params.after);
  }

  var url = API_BASE + '/users/@me/guilds?' + queryParts.join('&');
  console.log('Fetching guilds from: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list_guilds');

  var guilds = response.json();
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

function getGuild(http, headers, params) {
  if (!params.guild_id) {
    throw new Error('guild_id is required.');
  }

  var url = API_BASE + '/guilds/' + params.guild_id;
  console.log('Fetching guild: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'get_guild');

  var guild = response.json();
  return {
    success: true,
    operation: 'get_guild',
    data: guild,
    count: 1,
    timestamp: Date.now(),
  };
}

function listChannels(http, headers, params) {
  if (!params.guild_id) {
    throw new Error('guild_id is required.');
  }

  var url = API_BASE + '/guilds/' + params.guild_id + '/channels';
  console.log('Fetching channels from: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list_channels');

  var channels = response.json();
  return {
    success: true,
    operation: 'list_channels',
    data: channels,
    count: channels.length,
    timestamp: Date.now(),
  };
}

function listMessages(http, headers, params) {
  if (!params.channel_id) {
    throw new Error('channel_id is required.');
  }

  var limit = Math.min(params.limit || 50, 100);
  var queryParts = ['limit=' + limit];
  if (params.before) {
    queryParts.push('before=' + params.before);
  }
  if (params.after) {
    queryParts.push('after=' + params.after);
  }
  if (params.around) {
    queryParts.push('around=' + params.around);
  }

  var url =
    API_BASE +
    '/channels/' +
    params.channel_id +
    '/messages?' +
    queryParts.join('&');
  console.log('Fetching messages from: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list_messages');

  var messages = response.json();
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

function sendMessage(http, headers, params) {
  if (!params.channel_id) {
    throw new Error('channel_id is required.');
  }
  if (!params.content) {
    throw new Error('content is required.');
  }

  var payload = { content: params.content };
  if (params.embeds) {
    if (typeof params.embeds === 'string') {
      try {
        payload.embeds = JSON.parse(params.embeds);
      } catch (e) {
        throw new Error('Invalid embeds JSON: ' + e.message);
      }
    } else {
      payload.embeds = params.embeds;
    }
  }

  var url = API_BASE + '/channels/' + params.channel_id + '/messages';
  console.log('Sending message to: ' + url);

  var response = http.post(url, {
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

  handleError(response, 'send_message');

  var message = response.json();
  return {
    success: true,
    operation: 'send_message',
    data: message,
    count: 1,
    timestamp: Date.now(),
  };
}

function getUser(http, headers, params) {
  if (!params.user_id) {
    throw new Error('user_id is required.');
  }

  var url = API_BASE + '/users/' + params.user_id;
  console.log('Fetching user: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'get_user');

  var user = response.json();
  return {
    success: true,
    operation: 'get_user',
    data: user,
    count: 1,
    timestamp: Date.now(),
  };
}

function listMembers(http, headers, params) {
  if (!params.guild_id) {
    throw new Error('guild_id is required.');
  }

  var limit = Math.min(params.limit || 50, 1000);
  var queryParts = ['limit=' + limit];
  if (params.after) {
    queryParts.push('after=' + params.after);
  }

  var url =
    API_BASE +
    '/guilds/' +
    params.guild_id +
    '/members?' +
    queryParts.join('&');
  console.log('Fetching members from: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list_members');

  var members = response.json();
  return {
    success: true,
    operation: 'list_members',
    data: members,
    count: members.length,
    pagination: {
      hasNextPage: members.length >= limit,
      nextPageInfo:
        members.length > 0 ? members[members.length - 1].user.id : null,
    },
    timestamp: Date.now(),
  };
}

function createChannel(http, headers, params) {
  if (!params.guild_id) {
    throw new Error('guild_id is required.');
  }
  if (!params.name) {
    throw new Error('name is required.');
  }

  var payload = {
    name: params.name,
    type: params.type !== undefined ? Number(params.type) : 0,
  };
  if (params.topic) {
    payload.topic = params.topic;
  }

  var url = API_BASE + '/guilds/' + params.guild_id + '/channels';
  console.log('Creating channel in: ' + url);

  var response = http.post(url, {
    headers: headers,
    body: JSON.stringify(payload),
  });

  if (response.status === 0) {
    return {
      success: true,
      operation: 'create_channel',
      data: { pending: true },
    };
  }

  handleError(response, 'create_channel');

  var channel = response.json();
  return {
    success: true,
    operation: 'create_channel',
    data: channel,
    count: 1,
    timestamp: Date.now(),
  };
}
