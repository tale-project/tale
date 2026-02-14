// Microsoft Teams Connector - Microsoft Graph API
// This connector runs in a sandboxed environment with controlled HTTP access

var GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

var connector = {
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

  testConnection: function (ctx) {
    var accessToken = ctx.secrets.get('accessToken');

    if (!accessToken) {
      throw new Error('Access token is required. Please authorize via OAuth2.');
    }

    var response = ctx.http.get(GRAPH_BASE_URL + '/me', {
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

    var user = response.json();
    return {
      status: 'ok',
      displayName: user.displayName,
      email: user.mail || user.userPrincipalName,
    };
  },

  execute: function (ctx) {
    var operation = ctx.operation;
    var params = ctx.params;
    var http = ctx.http;
    var secrets = ctx.secrets;

    var accessToken = secrets.get('accessToken');
    if (!accessToken) {
      throw new Error('Access token is required.');
    }

    var headers = {
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

function handleError(response, operation) {
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
    var errorBody = '';
    try {
      var err = response.json();
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

function listTeams(http, headers, params) {
  var top = Math.min(params.top || 50, 999);
  var queryParts = ['$top=' + top];
  if (params.skip) {
    queryParts.push('$skip=' + params.skip);
  }

  var url = GRAPH_BASE_URL + '/me/joinedTeams?' + queryParts.join('&');
  console.log('Fetching teams from: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list teams');

  var data = response.json();
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

function getTeam(http, headers, params) {
  if (!params.teamId) {
    throw new Error('teamId is required.');
  }

  var url = GRAPH_BASE_URL + '/teams/' + params.teamId;
  console.log('Fetching team: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'get team');

  var team = response.json();
  return {
    success: true,
    operation: 'get_team',
    data: team,
    count: 1,
    timestamp: Date.now(),
  };
}

function listChannels(http, headers, params) {
  if (!params.teamId) {
    throw new Error('teamId is required.');
  }

  var url = GRAPH_BASE_URL + '/teams/' + params.teamId + '/channels';
  console.log('Fetching channels from: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list channels');

  var data = response.json();
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

function getChannel(http, headers, params) {
  if (!params.teamId) {
    throw new Error('teamId is required.');
  }
  if (!params.channelId) {
    throw new Error('channelId is required.');
  }

  var url =
    GRAPH_BASE_URL +
    '/teams/' +
    params.teamId +
    '/channels/' +
    params.channelId;
  console.log('Fetching channel: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'get channel');

  var channel = response.json();
  return {
    success: true,
    operation: 'get_channel',
    data: channel,
    count: 1,
    timestamp: Date.now(),
  };
}

function listMessages(http, headers, params) {
  if (!params.teamId) {
    throw new Error('teamId is required.');
  }
  if (!params.channelId) {
    throw new Error('channelId is required.');
  }

  var top = Math.min(params.top || 20, 50);
  var queryParts = ['$top=' + top];

  var url =
    GRAPH_BASE_URL +
    '/teams/' +
    params.teamId +
    '/channels/' +
    params.channelId +
    '/messages?' +
    queryParts.join('&');
  console.log('Fetching messages from: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list messages');

  var data = response.json();
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

function sendMessage(http, headers, params) {
  if (!params.teamId) {
    throw new Error('teamId is required.');
  }
  if (!params.channelId) {
    throw new Error('channelId is required.');
  }
  if (!params.content) {
    throw new Error('content is required.');
  }

  var url =
    GRAPH_BASE_URL +
    '/teams/' +
    params.teamId +
    '/channels/' +
    params.channelId +
    '/messages';
  var payload = {
    body: {
      content: params.content,
      contentType: params.contentType || 'text',
    },
  };

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

  handleError(response, 'send message');

  var message = response.json();
  return {
    success: true,
    operation: 'send_message',
    data: message,
    count: 1,
    timestamp: Date.now(),
  };
}

function listMembers(http, headers, params) {
  if (!params.teamId) {
    throw new Error('teamId is required.');
  }

  var top = params.top || 100;
  var queryParts = ['$top=' + top];
  if (params.skip) {
    queryParts.push('$skip=' + params.skip);
  }

  var url =
    GRAPH_BASE_URL +
    '/teams/' +
    params.teamId +
    '/members?' +
    queryParts.join('&');
  console.log('Fetching members from: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list members');

  var data = response.json();
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

function listChats(http, headers, params) {
  var top = Math.min(params.top || 20, 50);
  var queryParts = ['$top=' + top];
  if (params.skip) {
    queryParts.push('$skip=' + params.skip);
  }

  var url = GRAPH_BASE_URL + '/me/chats?' + queryParts.join('&');
  console.log('Fetching chats from: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list chats');

  var data = response.json();
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

function sendChatMessage(http, headers, params) {
  if (!params.chatId) {
    throw new Error('chatId is required.');
  }
  if (!params.content) {
    throw new Error('content is required.');
  }

  var url = GRAPH_BASE_URL + '/chats/' + params.chatId + '/messages';
  var payload = {
    body: {
      content: params.content,
      contentType: params.contentType || 'text',
    },
  };

  console.log('Sending chat message to: ' + url);

  var response = http.post(url, {
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

  var message = response.json();
  return {
    success: true,
    operation: 'send_chat_message',
    data: message,
    count: 1,
    timestamp: Date.now(),
  };
}
