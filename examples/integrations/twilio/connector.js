// Twilio Connector - Twilio REST API
// This connector runs in a sandboxed environment with controlled HTTP access

var API_BASE = 'https://api.twilio.com/2010-04-01';

var connector = {
  operations: [
    'send_sms',
    'list_messages',
    'get_message',
    'list_calls',
    'make_call',
    'get_account',
    'list_phone_numbers',
  ],

  testConnection: function (ctx) {
    var accountSid = ctx.secrets.get('username');
    var authToken = ctx.secrets.get('password');

    if (!accountSid) {
      throw new Error('Twilio Account SID is required.');
    }
    if (!authToken) {
      throw new Error('Twilio Auth Token is required.');
    }

    var authString = ctx.base64Encode(accountSid + ':' + authToken);
    var response = ctx.http.get(
      API_BASE + '/Accounts/' + accountSid + '.json',
      {
        headers: {
          Authorization: 'Basic ' + authString,
          Accept: 'application/json',
        },
      },
    );

    if (response.status === 401) {
      throw new Error(
        'Twilio authentication failed. Please verify your Account SID and Auth Token.',
      );
    }
    if (response.status !== 200) {
      throw new Error(
        'Twilio connection failed (' +
          response.status +
          '): ' +
          response.text(),
      );
    }

    var account = response.json();
    return {
      status: 'ok',
      accountSid: account.sid,
      friendlyName: account.friendly_name,
    };
  },

  execute: function (ctx) {
    var operation = ctx.operation;
    var params = ctx.params;
    var http = ctx.http;
    var secrets = ctx.secrets;
    var base64Encode = ctx.base64Encode;

    var accountSid = secrets.get('username');
    var authToken = secrets.get('password');
    if (!accountSid || !authToken) {
      throw new Error('Twilio Account SID and Auth Token are required.');
    }

    var authString = base64Encode(accountSid + ':' + authToken);
    var headers = {
      Authorization: 'Basic ' + authString,
      Accept: 'application/json',
    };

    if (operation === 'send_sms')
      return sendSms(http, headers, accountSid, params);
    if (operation === 'list_messages')
      return listMessages(http, headers, accountSid, params);
    if (operation === 'get_message')
      return getMessage(http, headers, accountSid, params);
    if (operation === 'list_calls')
      return listCalls(http, headers, accountSid, params);
    if (operation === 'make_call')
      return makeCall(http, headers, accountSid, params);
    if (operation === 'get_account')
      return getAccount(http, headers, accountSid);
    if (operation === 'list_phone_numbers')
      return listPhoneNumbers(http, headers, accountSid, params);

    throw new Error('Unknown operation: ' + operation);
  },
};

function handleError(response, operation) {
  if (response.status === 401) {
    throw new Error(
      'Authentication failed during ' +
        operation +
        '. Please verify your Twilio credentials.',
    );
  }
  if (response.status === 403) {
    throw new Error('Permission denied during ' + operation + '.');
  }
  if (response.status === 404) {
    throw new Error('Resource not found during ' + operation + '.');
  }
  if (response.status === 429) {
    throw new Error(
      'Rate limited by Twilio during ' +
        operation +
        '. Please try again later.',
    );
  }
  if (response.status >= 400) {
    var errorBody = '';
    try {
      var err = response.json();
      errorBody = err.message || err.more_info || JSON.stringify(err);
    } catch (e) {
      errorBody = response.text();
    }
    throw new Error(
      'Twilio API error during ' +
        operation +
        ' (' +
        response.status +
        '): ' +
        errorBody,
    );
  }
}

function encodeFormData(params) {
  var parts = [];
  for (var key in params) {
    if (params[key] !== undefined && params[key] !== null) {
      parts.push(
        encodeURIComponent(key) + '=' + encodeURIComponent(params[key]),
      );
    }
  }
  return parts.join('&');
}

function sendSms(http, headers, accountSid, params) {
  if (!params.to) {
    throw new Error('to (phone number in E.164 format) is required.');
  }
  if (!params.from) {
    throw new Error('from (Twilio phone number) is required.');
  }
  if (!params.body) {
    throw new Error('body (message text) is required.');
  }

  var url = API_BASE + '/Accounts/' + accountSid + '/Messages.json';
  var formData = encodeFormData({
    To: params.to,
    From: params.from,
    Body: params.body,
  });

  var response = http.post(url, {
    headers: {
      Authorization: headers.Authorization,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData,
  });

  if (response.status === 0) {
    return {
      success: true,
      operation: 'send_sms',
      data: { pending: true },
    };
  }
  handleError(response, 'send SMS');

  var message = response.json();
  return {
    success: true,
    operation: 'send_sms',
    data: message,
    count: 1,
    timestamp: Date.now(),
  };
}

function listMessages(http, headers, accountSid, params) {
  var queryParts = [];
  if (params.to) queryParts.push('To=' + encodeURIComponent(params.to));
  if (params.from) queryParts.push('From=' + encodeURIComponent(params.from));
  if (params.dateSent)
    queryParts.push('DateSent=' + encodeURIComponent(params.dateSent));
  queryParts.push('PageSize=' + Math.min(params.pageSize || 50, 1000));
  if (params.page !== undefined) queryParts.push('Page=' + params.page);

  var url =
    API_BASE +
    '/Accounts/' +
    accountSid +
    '/Messages.json?' +
    queryParts.join('&');
  var response = http.get(url, { headers: headers });
  handleError(response, 'list messages');

  var data = response.json();
  return {
    success: true,
    operation: 'list_messages',
    data: data.messages,
    count: data.messages.length,
    pagination: {
      hasNextPage: !!data.next_page_uri,
      nextPageInfo: data.next_page_uri || null,
    },
    timestamp: Date.now(),
  };
}

function getMessage(http, headers, accountSid, params) {
  if (!params.messageSid) {
    throw new Error('messageSid (message SID) is required.');
  }

  var url =
    API_BASE +
    '/Accounts/' +
    accountSid +
    '/Messages/' +
    params.messageSid +
    '.json';
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

function listCalls(http, headers, accountSid, params) {
  var queryParts = [];
  if (params.to) queryParts.push('To=' + encodeURIComponent(params.to));
  if (params.from) queryParts.push('From=' + encodeURIComponent(params.from));
  if (params.status)
    queryParts.push('Status=' + encodeURIComponent(params.status));
  queryParts.push('PageSize=' + Math.min(params.pageSize || 50, 1000));
  if (params.page !== undefined) queryParts.push('Page=' + params.page);

  var url =
    API_BASE +
    '/Accounts/' +
    accountSid +
    '/Calls.json?' +
    queryParts.join('&');
  var response = http.get(url, { headers: headers });
  handleError(response, 'list calls');

  var data = response.json();
  return {
    success: true,
    operation: 'list_calls',
    data: data.calls,
    count: data.calls.length,
    pagination: {
      hasNextPage: !!data.next_page_uri,
      nextPageInfo: data.next_page_uri || null,
    },
    timestamp: Date.now(),
  };
}

function makeCall(http, headers, accountSid, params) {
  if (!params.to) {
    throw new Error('to (phone number in E.164 format) is required.');
  }
  if (!params.from) {
    throw new Error('from (Twilio phone number) is required.');
  }
  if (!params.url) {
    throw new Error('url (TwiML URL for call instructions) is required.');
  }

  var url = API_BASE + '/Accounts/' + accountSid + '/Calls.json';
  var formParams = {
    To: params.to,
    From: params.from,
    Url: params.url,
  };
  if (params.method) {
    formParams.Method = params.method;
  }
  var formData = encodeFormData(formParams);

  var response = http.post(url, {
    headers: {
      Authorization: headers.Authorization,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData,
  });

  if (response.status === 0) {
    return {
      success: true,
      operation: 'make_call',
      data: { pending: true },
    };
  }
  handleError(response, 'make call');

  var call = response.json();
  return {
    success: true,
    operation: 'make_call',
    data: call,
    count: 1,
    timestamp: Date.now(),
  };
}

function getAccount(http, headers, accountSid) {
  var url = API_BASE + '/Accounts/' + accountSid + '.json';
  var response = http.get(url, { headers: headers });
  handleError(response, 'get account');

  var account = response.json();
  return {
    success: true,
    operation: 'get_account',
    data: account,
    count: 1,
    timestamp: Date.now(),
  };
}

function listPhoneNumbers(http, headers, accountSid, params) {
  var queryParts = [];
  queryParts.push('PageSize=' + Math.min(params.pageSize || 50, 1000));
  if (params.page !== undefined) queryParts.push('Page=' + params.page);

  var url =
    API_BASE +
    '/Accounts/' +
    accountSid +
    '/IncomingPhoneNumbers.json?' +
    queryParts.join('&');
  var response = http.get(url, { headers: headers });
  handleError(response, 'list phone numbers');

  var data = response.json();
  return {
    success: true,
    operation: 'list_phone_numbers',
    data: data.incoming_phone_numbers,
    count: data.incoming_phone_numbers.length,
    pagination: {
      hasNextPage: !!data.next_page_uri,
      nextPageInfo: data.next_page_uri || null,
    },
    timestamp: Date.now(),
  };
}
