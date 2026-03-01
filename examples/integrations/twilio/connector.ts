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

// Twilio Connector - Twilio REST API
// This connector runs in a sandboxed environment with controlled HTTP access

const API_BASE = 'https://api.twilio.com/2010-04-01';

const connector = {
  operations: [
    'send_sms',
    'list_messages',
    'get_message',
    'list_calls',
    'make_call',
    'get_account',
    'list_phone_numbers',
  ],

  testConnection: function (ctx: TestConnectionContext) {
    const accountSid = ctx.secrets.get('username');
    const authToken = ctx.secrets.get('password');

    if (!accountSid) {
      throw new Error('Twilio Account SID is required.');
    }
    if (!authToken) {
      throw new Error('Twilio Auth Token is required.');
    }

    const authString = ctx.base64Encode(accountSid + ':' + authToken);
    const response = ctx.http.get(
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

    const account = response.json();
    return {
      status: 'ok',
      accountSid: account.sid,
      friendlyName: account.friendly_name,
    };
  },

  execute: function (ctx: ConnectorContext) {
    const operation = ctx.operation;
    const params = ctx.params;
    const http = ctx.http;
    const secrets = ctx.secrets;
    const base64Encode = ctx.base64Encode;

    const accountSid = secrets.get('username');
    const authToken = secrets.get('password');
    if (!accountSid || !authToken) {
      throw new Error('Twilio Account SID and Auth Token are required.');
    }

    const authString = base64Encode(accountSid + ':' + authToken);
    const headers = {
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

function handleError(response: HttpResponse, operation: string) {
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
    let errorBody = '';
    try {
      const err = response.json();
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

function encodeFormData(params: Record<string, unknown>) {
  const parts: string[] = [];
  for (const key in params) {
    if (params[key] !== undefined && params[key] !== null) {
      parts.push(
        encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key])),
      );
    }
  }
  return parts.join('&');
}

function sendSms(
  http: HttpApi,
  headers: Record<string, string>,
  accountSid: string,
  params: Record<string, unknown>,
) {
  if (!params.to) {
    throw new Error('to (phone number in E.164 format) is required.');
  }
  if (!params.from) {
    throw new Error('from (Twilio phone number) is required.');
  }
  if (!params.body) {
    throw new Error('body (message text) is required.');
  }

  const url = API_BASE + '/Accounts/' + accountSid + '/Messages.json';
  const formData = encodeFormData({
    To: params.to,
    From: params.from,
    Body: params.body,
  });

  const response = http.post(url, {
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

  const message = response.json();
  return {
    success: true,
    operation: 'send_sms',
    data: message,
    count: 1,
    timestamp: Date.now(),
  };
}

function listMessages(
  http: HttpApi,
  headers: Record<string, string>,
  accountSid: string,
  params: Record<string, unknown>,
) {
  const queryParts: string[] = [];
  if (params.to)
    queryParts.push('To=' + encodeURIComponent(params.to as string));
  if (params.from)
    queryParts.push('From=' + encodeURIComponent(params.from as string));
  if (params.dateSent)
    queryParts.push(
      'DateSent=' + encodeURIComponent(params.dateSent as string),
    );
  queryParts.push(
    'PageSize=' + Math.min((params.pageSize || 50) as number, 1000),
  );
  if (params.page !== undefined) queryParts.push('Page=' + params.page);

  const url =
    API_BASE +
    '/Accounts/' +
    accountSid +
    '/Messages.json?' +
    queryParts.join('&');
  const response = http.get(url, { headers: headers });
  handleError(response, 'list messages');

  const data = response.json();
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

function getMessage(
  http: HttpApi,
  headers: Record<string, string>,
  accountSid: string,
  params: Record<string, unknown>,
) {
  if (!params.messageSid) {
    throw new Error('messageSid (message SID) is required.');
  }

  const url =
    API_BASE +
    '/Accounts/' +
    accountSid +
    '/Messages/' +
    params.messageSid +
    '.json';
  const response = http.get(url, { headers: headers });
  handleError(response, 'get message');

  const message = response.json();
  return {
    success: true,
    operation: 'get_message',
    data: message,
    count: 1,
    timestamp: Date.now(),
  };
}

function listCalls(
  http: HttpApi,
  headers: Record<string, string>,
  accountSid: string,
  params: Record<string, unknown>,
) {
  const queryParts: string[] = [];
  if (params.to)
    queryParts.push('To=' + encodeURIComponent(params.to as string));
  if (params.from)
    queryParts.push('From=' + encodeURIComponent(params.from as string));
  if (params.status)
    queryParts.push('Status=' + encodeURIComponent(params.status as string));
  queryParts.push(
    'PageSize=' + Math.min((params.pageSize || 50) as number, 1000),
  );
  if (params.page !== undefined) queryParts.push('Page=' + params.page);

  const url =
    API_BASE +
    '/Accounts/' +
    accountSid +
    '/Calls.json?' +
    queryParts.join('&');
  const response = http.get(url, { headers: headers });
  handleError(response, 'list calls');

  const data = response.json();
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

function makeCall(
  http: HttpApi,
  headers: Record<string, string>,
  accountSid: string,
  params: Record<string, unknown>,
) {
  if (!params.to) {
    throw new Error('to (phone number in E.164 format) is required.');
  }
  if (!params.from) {
    throw new Error('from (Twilio phone number) is required.');
  }
  if (!params.url) {
    throw new Error('url (TwiML URL for call instructions) is required.');
  }

  const url = API_BASE + '/Accounts/' + accountSid + '/Calls.json';
  const formParams: Record<string, unknown> = {
    To: params.to,
    From: params.from,
    Url: params.url,
  };
  if (params.method) {
    formParams.Method = params.method;
  }
  const formData = encodeFormData(formParams);

  const response = http.post(url, {
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

  const call = response.json();
  return {
    success: true,
    operation: 'make_call',
    data: call,
    count: 1,
    timestamp: Date.now(),
  };
}

function getAccount(
  http: HttpApi,
  headers: Record<string, string>,
  accountSid: string,
) {
  const url = API_BASE + '/Accounts/' + accountSid + '.json';
  const response = http.get(url, { headers: headers });
  handleError(response, 'get account');

  const account = response.json();
  return {
    success: true,
    operation: 'get_account',
    data: account,
    count: 1,
    timestamp: Date.now(),
  };
}

function listPhoneNumbers(
  http: HttpApi,
  headers: Record<string, string>,
  accountSid: string,
  params: Record<string, unknown>,
) {
  const queryParts: string[] = [];
  queryParts.push(
    'PageSize=' + Math.min((params.pageSize || 50) as number, 1000),
  );
  if (params.page !== undefined) queryParts.push('Page=' + params.page);

  const url =
    API_BASE +
    '/Accounts/' +
    accountSid +
    '/IncomingPhoneNumbers.json?' +
    queryParts.join('&');
  const response = http.get(url, { headers: headers });
  handleError(response, 'list phone numbers');

  const data = response.json();
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
