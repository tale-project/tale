// Microsoft Outlook Connector - Microsoft Graph API
// This connector runs in a sandboxed environment with controlled HTTP access

var GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

var connector = {
  operations: [
    'list_messages',
    'get_message',
    'search_messages',
    'send_message',
    'list_events',
    'get_event',
    'create_event',
    'list_contacts',
    'get_contact',
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

    if (operation === 'list_messages') {
      return listMessages(http, headers, params);
    }
    if (operation === 'get_message') {
      return getMessage(http, headers, params);
    }
    if (operation === 'search_messages') {
      return searchMessages(http, headers, params);
    }
    if (operation === 'send_message') {
      return sendMessage(http, headers, params);
    }
    if (operation === 'list_events') {
      return listEvents(http, headers, params);
    }
    if (operation === 'get_event') {
      return getEvent(http, headers, params);
    }
    if (operation === 'create_event') {
      return createEvent(http, headers, params);
    }
    if (operation === 'list_contacts') {
      return listContacts(http, headers, params);
    }
    if (operation === 'get_contact') {
      return getContact(http, headers, params);
    }

    throw new Error('Unknown operation: ' + operation);
  },
};

function escapeODataString(value) {
  return String(value).replace(/'/g, "''");
}

function mapGraphToEmailType(msg, accountEmail) {
  var fromAddr = msg.from && msg.from.emailAddress ? msg.from.emailAddress : {};
  var mapRecipients = function (list) {
    if (!list) return [];
    return list.map(function (r) {
      var addr = r.emailAddress || {};
      return { name: addr.name || '', address: addr.address || '' };
    });
  };

  var contentType =
    msg.body && msg.body.contentType ? msg.body.contentType.toLowerCase() : '';
  var bodyContent = msg.body ? msg.body.content || '' : '';

  var senderAddr = (fromAddr.address || '').toLowerCase();
  var direction =
    accountEmail && senderAddr === accountEmail.toLowerCase()
      ? 'outbound'
      : 'inbound';

  return {
    uid: 0,
    messageId: msg.internetMessageId || msg.id || '',
    from: [{ name: fromAddr.name || '', address: fromAddr.address || '' }],
    to: mapRecipients(msg.toRecipients),
    cc: mapRecipients(msg.ccRecipients),
    bcc: mapRecipients(msg.bccRecipients),
    subject: msg.subject || '',
    date: msg.receivedDateTime || msg.sentDateTime || '',
    text: contentType === 'text' ? bodyContent : '',
    html: contentType === 'html' ? bodyContent : '',
    flags: msg.isRead ? ['\\Seen'] : [],
    headers: {},
    attachments: [],
    conversationId: msg.conversationId || '',
    direction: direction,
  };
}

function getAccountEmail(http, headers) {
  var response = http.get(
    GRAPH_BASE_URL + '/me?$select=mail,userPrincipalName',
    { headers: headers },
  );
  if (response.status === 200) {
    var me = response.json();
    return me.mail || me.userPrincipalName || '';
  }
  return '';
}

function listMessages(http, headers, params) {
  var top = Math.min(params.top || 25, 100);
  var orderby = params.orderby || 'receivedDateTime desc';
  var filter = params.filter || '';

  // Graph API does not support $orderby combined with $filter on conversationId.
  // When this combination is detected, drop $orderby from the request and sort
  // the results in memory afterwards.
  var needsClientSort = false;
  if (filter && filter.indexOf('conversationId') !== -1 && params.orderby) {
    needsClientSort = true;
  }

  var queryParts = ['$top=' + top];
  if (!needsClientSort) {
    queryParts.push('$orderby=' + orderby);
  }

  if (filter) {
    queryParts.push('$filter=' + filter);
  } else if (params.folder) {
    queryParts.push(
      "$filter=parentFolderId eq '" + escapeODataString(params.folder) + "'",
    );
  }
  if (params.select) {
    queryParts.push('$select=' + params.select);
  } else {
    queryParts.push(
      '$select=id,subject,from,toRecipients,receivedDateTime,isRead,hasAttachments,bodyPreview',
    );
  }
  if (params.skip) {
    queryParts.push('$skip=' + params.skip);
  }

  var url = GRAPH_BASE_URL + '/me/messages?' + queryParts.join('&');
  console.log('Fetching messages from: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list messages');

  var data = response.json();
  var accountEmail = getAccountEmail(http, headers);
  var messages =
    params.format === 'email'
      ? data.value.map(function (msg) {
          return mapGraphToEmailType(msg, accountEmail);
        })
      : data.value;

  if (needsClientSort) {
    var field = params.format === 'email' ? 'date' : 'receivedDateTime';
    var desc = orderby.indexOf('desc') !== -1;
    messages.sort(function (a, b) {
      var ta = new Date(a[field] || 0).getTime();
      var tb = new Date(b[field] || 0).getTime();
      return desc ? tb - ta : ta - tb;
    });
  }

  return {
    success: true,
    operation: 'list_messages',
    data: messages,
    count: messages.length,
    pagination: {
      hasNextPage: !!data['@odata.nextLink'],
      nextLink: data['@odata.nextLink'] || null,
    },
    timestamp: Date.now(),
  };
}

function getMessage(http, headers, params) {
  if (!params.messageId) {
    throw new Error('messageId is required.');
  }

  var url = GRAPH_BASE_URL + '/me/messages/' + params.messageId;
  console.log('Fetching message: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'get message');

  var message = response.json();
  return {
    success: true,
    operation: 'get_message',
    data: message,
    count: 1,
    timestamp: Date.now(),
  };
}

function searchMessages(http, headers, params) {
  if (!params.query) {
    throw new Error('query is required for searching messages.');
  }

  var top = Math.min(params.top || 25, 100);
  var queryParts = [
    '$top=' + top,
    '$search="' + encodeURIComponent(params.query) + '"',
    '$select=id,subject,from,toRecipients,receivedDateTime,isRead,hasAttachments,bodyPreview',
  ];

  var url = GRAPH_BASE_URL + '/me/messages?' + queryParts.join('&');
  console.log('Searching messages: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'search messages');

  var data = response.json();
  return {
    success: true,
    operation: 'search_messages',
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
  if (!params.to) {
    throw new Error('to (recipient email) is required.');
  }
  if (!params.subject) {
    throw new Error('subject is required.');
  }

  var toRecipients = Array.isArray(params.to) ? params.to : [params.to];
  var message = {
    subject: params.subject,
    body: {
      contentType: params.contentType || 'Text',
      content: params.body || '',
    },
    toRecipients: toRecipients.map(function (email) {
      return { emailAddress: { address: email } };
    }),
  };

  if (params.cc) {
    var ccRecipients = Array.isArray(params.cc) ? params.cc : [params.cc];
    message.ccRecipients = ccRecipients.map(function (email) {
      return { emailAddress: { address: email } };
    });
  }

  var url = GRAPH_BASE_URL + '/me/sendMail';
  console.log('Sending message via: ' + url);

  var response = http.post(url, {
    headers: headers,
    body: JSON.stringify({ message: message }),
  });
  handleError(response, 'send message');

  return {
    success: true,
    operation: 'send_message',
    data: { sent: true, to: toRecipients, subject: params.subject },
    count: 1,
    timestamp: Date.now(),
  };
}

function listEvents(http, headers, params) {
  var top = Math.min(params.top || 25, 100);
  var queryParts = [
    '$top=' + top,
    '$orderby=start/dateTime',
    '$select=id,subject,start,end,location,organizer,isAllDay,bodyPreview',
  ];

  if (params.startDateTime && params.endDateTime) {
    queryParts.push(
      "$filter=start/dateTime ge '" +
        escapeODataString(params.startDateTime) +
        "' and end/dateTime le '" +
        escapeODataString(params.endDateTime) +
        "'",
    );
  }

  var url = GRAPH_BASE_URL + '/me/events?' + queryParts.join('&');
  console.log('Fetching events from: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list events');

  var data = response.json();
  return {
    success: true,
    operation: 'list_events',
    data: data.value,
    count: data.value.length,
    pagination: {
      hasNextPage: !!data['@odata.nextLink'],
      nextLink: data['@odata.nextLink'] || null,
    },
    timestamp: Date.now(),
  };
}

function getEvent(http, headers, params) {
  if (!params.eventId) {
    throw new Error('eventId is required.');
  }

  var url = GRAPH_BASE_URL + '/me/events/' + params.eventId;
  console.log('Fetching event: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'get event');

  var event = response.json();
  return {
    success: true,
    operation: 'get_event',
    data: event,
    count: 1,
    timestamp: Date.now(),
  };
}

function createEvent(http, headers, params) {
  if (!params.subject) {
    throw new Error('subject is required.');
  }
  if (!params.startDateTime) {
    throw new Error('startDateTime is required (ISO 8601 format).');
  }
  if (!params.endDateTime) {
    throw new Error('endDateTime is required (ISO 8601 format).');
  }

  var event = {
    subject: params.subject,
    start: {
      dateTime: params.startDateTime,
      timeZone: params.timeZone || 'UTC',
    },
    end: {
      dateTime: params.endDateTime,
      timeZone: params.timeZone || 'UTC',
    },
  };

  if (params.body) {
    event.body = {
      contentType: params.contentType || 'Text',
      content: params.body,
    };
  }

  if (params.location) {
    event.location = { displayName: params.location };
  }

  if (params.attendees) {
    var attendeeList = Array.isArray(params.attendees)
      ? params.attendees
      : [params.attendees];
    event.attendees = attendeeList.map(function (email) {
      return {
        emailAddress: { address: email },
        type: 'required',
      };
    });
  }

  if (params.isAllDay) {
    event.isAllDay = true;
  }

  var url = GRAPH_BASE_URL + '/me/events';
  console.log('Creating event via: ' + url);

  var response = http.post(url, {
    headers: headers,
    body: JSON.stringify(event),
  });
  handleError(response, 'create event');

  var created = response.json();
  return {
    success: true,
    operation: 'create_event',
    data: created,
    count: 1,
    timestamp: Date.now(),
  };
}

function listContacts(http, headers, params) {
  var top = Math.min(params.top || 25, 100);
  var queryParts = [
    '$top=' + top,
    '$orderby=displayName',
    '$select=id,displayName,givenName,surname,emailAddresses,businessPhones,mobilePhone,companyName,jobTitle',
  ];

  if (params.search) {
    queryParts.push(
      "$filter=startsWith(displayName,'" +
        escapeODataString(params.search) +
        "') or startsWith(givenName,'" +
        escapeODataString(params.search) +
        "') or startsWith(surname,'" +
        escapeODataString(params.search) +
        "')",
    );
  }
  if (params.skip) {
    queryParts.push('$skip=' + params.skip);
  }

  var url = GRAPH_BASE_URL + '/me/contacts?' + queryParts.join('&');
  console.log('Fetching contacts from: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list contacts');

  var data = response.json();
  return {
    success: true,
    operation: 'list_contacts',
    data: data.value,
    count: data.value.length,
    pagination: {
      hasNextPage: !!data['@odata.nextLink'],
      nextLink: data['@odata.nextLink'] || null,
    },
    timestamp: Date.now(),
  };
}

function getContact(http, headers, params) {
  if (!params.contactId) {
    throw new Error('contactId is required.');
  }

  var url = GRAPH_BASE_URL + '/me/contacts/' + params.contactId;
  console.log('Fetching contact: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'get contact');

  var contact = response.json();
  return {
    success: true,
    operation: 'get_contact',
    data: contact,
    count: 1,
    timestamp: Date.now(),
  };
}

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
