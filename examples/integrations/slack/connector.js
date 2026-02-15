// Slack Connector - Slack Web API
// This connector runs in a sandboxed environment with controlled HTTP access

var API_BASE = 'https://slack.com/api/';

var connector = {
  operations: [
    'list_channels',
    'get_channel',
    'list_messages',
    'send_message',
    'list_users',
    'get_user',
    'upload_file',
  ],

  testConnection: function (ctx) {
    var accessToken = ctx.secrets.get('accessToken');

    if (!accessToken) {
      throw new Error(
        'Slack bot token is required. Please authorize via OAuth2.',
      );
    }

    var response = ctx.http.post(API_BASE + 'auth.test', {
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
    });

    handleError(response, 'auth test');
    var data = response.json();
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

  execute: function (ctx) {
    var operation = ctx.operation;
    var params = ctx.params;
    var http = ctx.http;
    var secrets = ctx.secrets;

    var accessToken = secrets.get('accessToken');
    if (!accessToken) {
      throw new Error('Slack bot token is required.');
    }

    var headers = {
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

function handleSlackResponse(response, operation) {
  handleError(response, operation);
  var data = response.json();
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

function handleError(response, operation) {
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
    var errorBody = '';
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

function listChannels(http, headers, params) {
  var body = {
    limit: Math.min(params.limit || 100, 200),
  };
  if (params.cursor) {
    body.cursor = params.cursor;
  }
  if (params.types) {
    body.types = params.types;
  }

  var response = http.post(API_BASE + 'conversations.list', {
    headers: headers,
    body: JSON.stringify(body),
  });
  var data = handleSlackResponse(response, 'list channels');

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

function getChannel(http, headers, params) {
  if (!params.channel) {
    throw new Error('channel (channel ID) is required.');
  }

  var response = http.post(API_BASE + 'conversations.info', {
    headers: {
      Authorization: headers.Authorization,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'channel=' + encodeURIComponent(params.channel),
  });
  var data = handleSlackResponse(response, 'get channel');

  return {
    success: true,
    operation: 'get_channel',
    data: data.channel,
    count: 1,
    timestamp: Date.now(),
  };
}

function listMessages(http, headers, params) {
  if (!params.channel) {
    throw new Error('channel (channel ID) is required.');
  }

  var body = {
    channel: params.channel,
    limit: Math.min(params.limit || 50, 200),
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

  var response = http.post(API_BASE + 'conversations.history', {
    headers: headers,
    body: JSON.stringify(body),
  });
  var data = handleSlackResponse(response, 'list messages');

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

function sendMessage(http, headers, params) {
  if (!params.channel) {
    throw new Error('channel (channel ID) is required.');
  }
  if (!params.text) {
    throw new Error('text (message text) is required.');
  }

  var payload = {
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

  var response = http.post(API_BASE + 'chat.postMessage', {
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
  var data = handleSlackResponse(response, 'send message');

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

function listUsers(http, headers, params) {
  var body = {
    limit: Math.min(params.limit || 100, 200),
  };
  if (params.cursor) {
    body.cursor = params.cursor;
  }

  var response = http.post(API_BASE + 'users.list', {
    headers: headers,
    body: JSON.stringify(body),
  });
  var data = handleSlackResponse(response, 'list users');

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

function getUser(http, headers, params) {
  if (!params.user) {
    throw new Error('user (user ID) is required.');
  }

  var response = http.post(API_BASE + 'users.info', {
    headers: {
      Authorization: headers.Authorization,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'user=' + encodeURIComponent(params.user),
  });
  var data = handleSlackResponse(response, 'get user');

  return {
    success: true,
    operation: 'get_user',
    data: data.user,
    count: 1,
    timestamp: Date.now(),
  };
}

function uploadFile(http, headers, params) {
  if (!params.channels) {
    throw new Error('channels (comma-separated channel IDs) is required.');
  }
  if (!params.content) {
    throw new Error('content (file content) is required.');
  }

  var filename = params.filename || 'file.txt';
  var contentLength = params.content.length;

  var urlResponse = http.post(API_BASE + 'files.getUploadURLExternal', {
    headers: {
      Authorization: headers.Authorization,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body:
      'filename=' + encodeURIComponent(filename) + '&length=' + contentLength,
  });
  var urlData = handleSlackResponse(urlResponse, 'get upload URL');

  var uploadResponse = http.post(urlData.upload_url, {
    headers: { 'Content-Type': 'text/plain' },
    body: params.content,
  });
  handleError(uploadResponse, 'upload file content');

  var channelList = params.channels.split(',').map(function (ch) {
    return ch.trim();
  });
  var files = [{ id: urlData.file_id }];
  if (params.title) {
    files[0].title = params.title;
  }

  var completeBody = {
    files: files,
    channel_id: channelList[0],
  };
  if (params.initial_comment) {
    completeBody.initial_comment = params.initial_comment;
  }

  var completeResponse = http.post(API_BASE + 'files.completeUploadExternal', {
    headers: headers,
    body: JSON.stringify(completeBody),
  });
  if (completeResponse.status === 0) {
    return {
      success: true,
      operation: 'upload_file',
      data: { pending: true },
    };
  }
  var completeData = handleSlackResponse(completeResponse, 'complete upload');

  var fileInfo =
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
