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

// Microsoft Outlook Connector - Microsoft Graph API
// This connector runs in a sandboxed environment with controlled HTTP access

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

const connector = {
  operations: [
    'list_messages',
    'get_message',
    'get_attachments',
    'search_messages',
    'send_message',
    'check_delivery',
    'list_events',
    'get_event',
    'create_event',
    'list_contacts',
    'get_contact',
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

    const user = response.json() as Record<string, string>;
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
    const files = ctx.files;

    const accessToken = secrets.get('accessToken');
    if (!accessToken) {
      throw new Error('Access token is required.');
    }

    const headers = {
      Authorization: 'Bearer ' + accessToken,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    if (operation === 'list_messages') {
      return listMessages(http, headers, params);
    }
    if (operation === 'get_message') {
      return getMessage(http, headers, params, files);
    }
    if (operation === 'get_attachments') {
      return getAttachments(http, headers, files, params);
    }
    if (operation === 'search_messages') {
      return searchMessages(http, headers, params);
    }
    if (operation === 'send_message') {
      return sendMessage(http, headers, params);
    }
    if (operation === 'check_delivery') {
      return checkDelivery(http, headers, params);
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

function escapeODataString(value: unknown) {
  return String(value).replace(/'/g, "''");
}

interface GraphEmailAddress {
  name?: string;
  address?: string;
}

interface GraphRecipient {
  emailAddress?: GraphEmailAddress;
}

interface GraphAttachment {
  '@odata.type'?: string;
  id?: string;
  name?: string;
  contentType?: string;
  contentId?: string;
  contentBytes?: string;
  size?: number;
}

interface GraphMessage {
  id?: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  from?: { emailAddress?: GraphEmailAddress };
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  body?: { contentType?: string; content?: string };
  attachments?: GraphAttachment[];
}

function mapGraphToEmailType(msg: GraphMessage, accountEmail: string) {
  const fromAddr =
    msg.from && msg.from.emailAddress ? msg.from.emailAddress : {};
  const mapRecipients = function (list: GraphRecipient[] | undefined) {
    if (!list) return [];
    return list.map(function (r) {
      const addr = r.emailAddress || {};
      return { name: addr.name || '', address: addr.address || '' };
    });
  };

  const contentType =
    msg.body && msg.body.contentType ? msg.body.contentType.toLowerCase() : '';
  const bodyContent = msg.body ? msg.body.content || '' : '';

  const senderAddr = (fromAddr.address || '').toLowerCase();
  const direction =
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
    attachments: (msg.attachments || [])
      .filter(function (att) {
        return att['@odata.type'] === '#microsoft.graph.fileAttachment';
      })
      .map(function (att) {
        const mapped: Record<string, unknown> = {
          id: att.id,
          filename: att.name || 'attachment',
          contentType: att.contentType || 'application/octet-stream',
          size: att.size || 0,
        };
        if (att.contentId) {
          mapped.contentId = att.contentId.replace(/^<|>$/g, '');
        }
        return mapped;
      }),
    hasAttachments: !!msg.hasAttachments,
    conversationId: msg.conversationId || '',
    direction: direction,
  };
}

function getAccountEmail(http: HttpApi, headers: Record<string, string>) {
  const response = http.get(
    GRAPH_BASE_URL + '/me?$select=mail,userPrincipalName',
    { headers: headers },
  );
  if (response.status === 200) {
    const me = response.json() as Record<string, string>;
    return me.mail || me.userPrincipalName || '';
  }
  return '';
}

function listMessages(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const top = Math.min((params.top as number) || 25, 100);
  const orderby = (params.orderby as string) || 'receivedDateTime desc';
  const filter = (params.filter as string) || '';

  // Graph API does not support $orderby combined with $filter on conversationId.
  // When this combination is detected, drop $orderby from the request and sort
  // the results in memory afterwards.
  let needsClientSort = false;
  if (filter && filter.indexOf('conversationId') !== -1 && orderby) {
    needsClientSort = true;
  }

  const queryParts = ['$top=' + top];
  if (!needsClientSort) {
    queryParts.push('$orderby=' + orderby);
  }

  // Exclude draft messages — drafts should never enter the sync pipeline
  const draftFilter = 'isDraft eq false';
  if (filter) {
    queryParts.push('$filter=' + filter + ' and ' + draftFilter);
  } else if (params.folder) {
    queryParts.push(
      "$filter=parentFolderId eq '" +
        escapeODataString(params.folder) +
        "' and " +
        draftFilter,
    );
  } else {
    queryParts.push('$filter=' + draftFilter);
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
  if (params.expand) {
    queryParts.push('$expand=' + params.expand);
  }

  const url = GRAPH_BASE_URL + '/me/messages?' + queryParts.join('&');
  console.log('Fetching messages from: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list messages');

  const data = response.json() as Record<string, unknown>;
  const accountEmail = getAccountEmail(http, headers);
  const rawValues = (data.value || []) as GraphMessage[];
  const messages =
    params.format === 'email'
      ? rawValues.map(function (msg) {
          return mapGraphToEmailType(msg, accountEmail);
        })
      : rawValues;

  if (needsClientSort) {
    const field = params.format === 'email' ? 'date' : 'receivedDateTime';
    const desc = orderby.indexOf('desc') !== -1;
    messages.sort(function (a, b) {
      const ta = new Date((a as Record<string, string>)[field] || 0).getTime();
      const tb = new Date((b as Record<string, string>)[field] || 0).getTime();
      return desc ? tb - ta : ta - tb;
    });
  }

  return {
    success: true,
    operation: 'list_messages',
    data: messages,
    count: messages.length,
    pagination: {
      hasNextPage: !!(data as Record<string, unknown>)['@odata.nextLink'],
      nextLink: (data as Record<string, unknown>)['@odata.nextLink'] || null,
    },
    timestamp: Date.now(),
  };
}

function getMessage(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
  files: FilesApi | undefined,
) {
  if (!params.messageId) {
    throw new Error('messageId is required.');
  }

  const url = GRAPH_BASE_URL + '/me/messages/' + params.messageId;
  console.log('Fetching message: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'get message');

  const message = response.json() as Record<string, unknown>;

  if (params.includeAttachments && message.hasAttachments && files) {
    const attachmentResult = getAttachments(http, headers, files, {
      messageId: params.messageId,
    });
    message.attachmentFiles = attachmentResult.data;
  }

  return {
    success: true,
    operation: 'get_message',
    data: message,
    count: 1,
    timestamp: Date.now(),
  };
}

function searchMessages(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.query) {
    throw new Error('query is required for searching messages.');
  }

  const top = Math.min((params.top as number) || 25, 100);
  const queryParts = [
    '$top=' + top,
    '$search="' + encodeURIComponent(params.query as string) + '"',
    '$select=id,subject,from,toRecipients,receivedDateTime,isRead,hasAttachments,bodyPreview',
  ];

  const url = GRAPH_BASE_URL + '/me/messages?' + queryParts.join('&');
  console.log('Searching messages: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'search messages');

  const data = response.json() as Record<string, unknown>;
  const values = (data.value || []) as unknown[];
  return {
    success: true,
    operation: 'search_messages',
    data: values,
    count: values.length,
    pagination: {
      hasNextPage: !!data['@odata.nextLink'],
      nextLink: data['@odata.nextLink'] || null,
    },
    timestamp: Date.now(),
  };
}

// Look up a message's Graph internal ID by its internet message ID.
// Returns the Graph ID string, or null if not found / still pending.
function findGraphMessageByInternetId(
  http: HttpApi,
  headers: Record<string, string>,
  internetMessageId: string,
): string | null {
  const encoded = encodeURIComponent(
    "internetMessageId eq '" + escapeODataString(internetMessageId) + "'",
  );
  const url =
    GRAPH_BASE_URL + '/me/messages?$filter=' + encoded + '&$select=id&$top=1';
  const response = http.get(url, { headers: headers });
  // status 0 = sandbox placeholder (HTTP not yet executed)
  if (response.status === 0) return 'pending';
  if (response.status !== 200) return null;
  const data = response.json() as {
    value?: Array<{ id: string }>;
  };
  return data.value && data.value.length > 0 ? data.value[0].id : null;
}

function sendMessage(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.to) {
    throw new Error('to (recipient email) is required.');
  }
  if (!params.subject) {
    throw new Error('subject is required.');
  }

  const toRecipients = Array.isArray(params.to)
    ? (params.to as string[])
    : [params.to as string];

  // When replying to a thread, find the original message and use Graph's
  // reply endpoint so Outlook handles threading natively.
  if (params.inReplyTo) {
    const graphMsgId = findGraphMessageByInternetId(
      http,
      headers,
      params.inReplyTo as string,
    );

    // Still waiting for the search HTTP call to complete — return early
    // so the sandbox multi-pass loop can execute it before we proceed.
    if (graphMsgId === 'pending') {
      return {
        success: true,
        operation: 'send_message',
        data: { pending: true },
      };
    }

    if (graphMsgId) {
      return sendReply(http, headers, params, graphMsgId, toRecipients);
    }

    console.log(
      'Could not find message for inReplyTo, falling back to sendMail',
    );
  }

  return sendDirectMail(http, headers, params, toRecipients);
}

// Helper: send a draft and return a result with its internetMessageId.
// Uses POST /me/messages/{draftId}/send (returns 202, no body).
function sendDraftAndReturn(
  http: HttpApi,
  headers: Record<string, string>,
  draftId: string,
  internetMessageId: string | undefined,
  toRecipients: string[],
  subject: unknown,
  isReply: boolean,
) {
  const sendUrl = GRAPH_BASE_URL + '/me/messages/' + draftId + '/send';
  console.log('Sending draft via: ' + sendUrl);

  const sendResponse = http.post(sendUrl, { headers: headers, body: '' });
  // status 0 = sandbox placeholder, will be executed on next pass
  if (sendResponse.status === 0) {
    return {
      success: true,
      operation: 'send_message',
      data: { pending: true },
    };
  }
  handleError(sendResponse, 'send draft');

  return {
    success: true,
    operation: 'send_message',
    data: {
      sent: true,
      to: toRecipients,
      subject: subject,
      isReply: !!isReply,
      internetMessageId: internetMessageId || null,
    },
    count: 1,
    timestamp: Date.now(),
  };
}

// Create a new draft message, then send it.
// This lets us capture the internetMessageId (assigned at draft creation).
function sendDirectMail(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
  toRecipients: string[],
) {
  const draft: Record<string, unknown> = {
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
    const ccRecipients = Array.isArray(params.cc)
      ? (params.cc as string[])
      : [params.cc as string];
    draft.ccRecipients = ccRecipients.map(function (email) {
      return { emailAddress: { address: email } };
    });
  }

  const createUrl = GRAPH_BASE_URL + '/me/messages';
  console.log('Creating draft via: ' + createUrl);

  const createResponse = http.post(createUrl, {
    headers: headers,
    body: JSON.stringify(draft),
  });
  if (createResponse.status === 0) {
    return {
      success: true,
      operation: 'send_message',
      data: { pending: true },
    };
  }
  handleError(createResponse, 'create draft');

  const created = createResponse.json() as Record<string, unknown>;

  const attachments = params.attachments as
    | Array<{ url: string; name: string; contentType?: string }>
    | undefined;
  if (attachments && attachments.length > 0) {
    const attached = addAttachmentsToDraft(
      http,
      headers,
      created.id as string,
      attachments,
    );
    if (!attached) {
      return {
        success: true,
        operation: 'send_message',
        data: { pending: true },
      };
    }
  }

  return sendDraftAndReturn(
    http,
    headers,
    created.id as string,
    created.internetMessageId as string | undefined,
    toRecipients,
    params.subject,
    false,
  );
}

// Create a reply draft via createReply, then send it.
// Graph sets threading headers (In-Reply-To, References, conversationId) automatically.
function sendReply(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
  graphMessageId: string,
  toRecipients: string[],
) {
  const createUrl =
    GRAPH_BASE_URL + '/me/messages/' + graphMessageId + '/createReply';
  console.log('Creating reply draft via: ' + createUrl);

  const replyMessage: Record<string, unknown> = {
    body: {
      contentType: params.contentType || 'Text',
      content: params.body || '',
    },
    toRecipients: toRecipients.map(function (email) {
      return { emailAddress: { address: email } };
    }),
  };

  if (params.cc) {
    const ccRecipients = Array.isArray(params.cc)
      ? (params.cc as string[])
      : [params.cc as string];
    replyMessage.ccRecipients = ccRecipients.map(function (email) {
      return { emailAddress: { address: email } };
    });
  }

  const createResponse = http.post(createUrl, {
    headers: headers,
    body: JSON.stringify({ message: replyMessage }),
  });
  if (createResponse.status === 0) {
    return {
      success: true,
      operation: 'send_message',
      data: { pending: true },
    };
  }
  handleError(createResponse, 'create reply draft');

  const created = createResponse.json() as Record<string, unknown>;

  const attachments = params.attachments as
    | Array<{ url: string; name: string; contentType?: string }>
    | undefined;
  if (attachments && attachments.length > 0) {
    const attached = addAttachmentsToDraft(
      http,
      headers,
      created.id as string,
      attachments,
    );
    if (!attached) {
      return {
        success: true,
        operation: 'send_message',
        data: { pending: true },
      };
    }
  }

  return sendDraftAndReturn(
    http,
    headers,
    created.id as string,
    created.internetMessageId as string | undefined,
    toRecipients,
    params.subject,
    true,
  );
}

// Verify that a sent message actually appeared in the mailbox (Sent Items).
// Accepts { internetMessageId } and returns { delivered: true/false }.
function checkDelivery(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.internetMessageId) {
    throw new Error('internetMessageId is required for check_delivery.');
  }

  const graphId = findGraphMessageByInternetId(
    http,
    headers,
    params.internetMessageId as string,
  );

  if (graphId === 'pending') {
    return {
      success: true,
      operation: 'check_delivery',
      data: { pending: true },
    };
  }

  return {
    success: true,
    operation: 'check_delivery',
    data: {
      delivered: !!graphId,
      internetMessageId: params.internetMessageId,
    },
    timestamp: Date.now(),
  };
}

function listEvents(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const top = Math.min((params.top as number) || 25, 100);
  const queryParts = [
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

  const url = GRAPH_BASE_URL + '/me/events?' + queryParts.join('&');
  console.log('Fetching events from: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list events');

  const data = response.json() as Record<string, unknown>;
  const values = (data.value || []) as unknown[];
  return {
    success: true,
    operation: 'list_events',
    data: values,
    count: values.length,
    pagination: {
      hasNextPage: !!data['@odata.nextLink'],
      nextLink: data['@odata.nextLink'] || null,
    },
    timestamp: Date.now(),
  };
}

function getEvent(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.eventId) {
    throw new Error('eventId is required.');
  }

  const url = GRAPH_BASE_URL + '/me/events/' + params.eventId;
  console.log('Fetching event: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'get event');

  const event = response.json();
  return {
    success: true,
    operation: 'get_event',
    data: event,
    count: 1,
    timestamp: Date.now(),
  };
}

function createEvent(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.subject) {
    throw new Error('subject is required.');
  }
  if (!params.startDateTime) {
    throw new Error('startDateTime is required (ISO 8601 format).');
  }
  if (!params.endDateTime) {
    throw new Error('endDateTime is required (ISO 8601 format).');
  }

  const event: Record<string, unknown> = {
    subject: params.subject,
    start: {
      dateTime: params.startDateTime,
      timeZone: (params.timeZone as string) || 'UTC',
    },
    end: {
      dateTime: params.endDateTime,
      timeZone: (params.timeZone as string) || 'UTC',
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
    const attendeeList = Array.isArray(params.attendees)
      ? (params.attendees as string[])
      : [params.attendees as string];
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

  const url = GRAPH_BASE_URL + '/me/events';
  console.log('Creating event via: ' + url);

  const response = http.post(url, {
    headers: headers,
    body: JSON.stringify(event),
  });
  handleError(response, 'create event');

  const created = response.json();
  return {
    success: true,
    operation: 'create_event',
    data: created,
    count: 1,
    timestamp: Date.now(),
  };
}

function listContacts(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const top = Math.min((params.top as number) || 25, 100);
  const queryParts = [
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

  const url = GRAPH_BASE_URL + '/me/contacts?' + queryParts.join('&');
  console.log('Fetching contacts from: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list contacts');

  const data = response.json() as Record<string, unknown>;
  const values = (data.value || []) as unknown[];
  return {
    success: true,
    operation: 'list_contacts',
    data: values,
    count: values.length,
    pagination: {
      hasNextPage: !!data['@odata.nextLink'],
      nextLink: data['@odata.nextLink'] || null,
    },
    timestamp: Date.now(),
  };
}

function getContact(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.contactId) {
    throw new Error('contactId is required.');
  }

  const url = GRAPH_BASE_URL + '/me/contacts/' + params.contactId;
  console.log('Fetching contact: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'get contact');

  const contact = response.json();
  return {
    success: true,
    operation: 'get_contact',
    data: contact,
    count: 1,
    timestamp: Date.now(),
  };
}

function getAttachments(
  http: HttpApi,
  headers: Record<string, string>,
  files: FilesApi | undefined,
  params: Record<string, unknown>,
) {
  if (!params.messageId) {
    throw new Error('messageId is required.');
  }
  if (!files) {
    throw new Error(
      'File storage is not available. The ctx.files API is required for attachment operations.',
    );
  }

  // The stored externalMessageId may be an RFC 2822 internet message ID
  // (e.g. "<ABC@prod.outlook.com>") rather than a Graph internal ID.
  // The Graph API requires the internal ID for resource paths.
  let graphId = params.messageId as string;
  if (graphId.indexOf('<') !== -1 || graphId.indexOf('@') !== -1) {
    const resolved = findGraphMessageByInternetId(http, headers, graphId);
    if (!resolved || resolved === 'pending') {
      throw new Error(
        'Could not resolve internet message ID to Graph ID: ' + graphId,
      );
    }
    graphId = resolved;
  }

  const url = GRAPH_BASE_URL + '/me/messages/' + graphId + '/attachments';
  console.log('Fetching attachments from: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'get attachments');

  const data = response.json() as {
    value: Array<{
      '@odata.type'?: string;
      id?: string;
      name?: string;
      contentType?: string;
      contentId?: string;
      contentBytes?: string;
      size?: number;
    }>;
  };
  const attachments: Array<Record<string, unknown>> = [];

  for (let i = 0; i < data.value.length; i++) {
    const att = data.value[i];
    if (att['@odata.type'] !== '#microsoft.graph.fileAttachment') {
      continue;
    }

    const fileName = att.name || 'attachment';
    const contentType = att.contentType || 'application/octet-stream';

    const inlineContentId = att.contentId
      ? att.contentId.replace(/^<|>$/g, '')
      : undefined;

    if (att.contentBytes) {
      const storedFile = files.store(att.contentBytes, {
        encoding: 'base64',
        contentType: contentType,
        fileName: fileName,
      });
      const entry: Record<string, unknown> = {
        id: att.id,
        name: fileName,
        contentType: contentType,
        size: att.size,
        fileId: storedFile.fileId,
        url: storedFile.url,
      };
      if (inlineContentId) {
        entry.contentId = inlineContentId;
      }
      attachments.push(entry);
    } else {
      const downloadUrl =
        GRAPH_BASE_URL +
        '/me/messages/' +
        graphId +
        '/attachments/' +
        att.id +
        '/$value';
      const downloadedFile = files.download(downloadUrl, {
        headers: { Authorization: headers.Authorization },
        fileName: fileName,
      });
      const dlEntry: Record<string, unknown> = {
        id: att.id,
        name: fileName,
        contentType: contentType,
        size: att.size,
        fileId: downloadedFile.fileId,
        url: downloadedFile.url,
      };
      if (inlineContentId) {
        dlEntry.contentId = inlineContentId;
      }
      attachments.push(dlEntry);
    }
  }

  return {
    success: true,
    operation: 'get_attachments',
    data: attachments,
    count: attachments.length,
    timestamp: Date.now(),
  };
}

function addAttachmentsToDraft(
  http: HttpApi,
  headers: Record<string, string>,
  draftId: string,
  attachments: Array<{ url: string; name: string; contentType?: string }>,
) {
  const url = GRAPH_BASE_URL + '/me/messages/' + draftId + '/attachments';
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];

    // Download the file content as base64 from Convex storage URL
    const fileResponse = http.get(att.url, { responseType: 'base64' });
    if (fileResponse.status === 0) {
      return false;
    }
    if (fileResponse.status !== 200) {
      throw new Error(
        'Failed to download attachment "' +
          att.name +
          '" (' +
          fileResponse.status +
          ')',
      );
    }

    const payload = {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: att.name,
      contentType: att.contentType || 'application/octet-stream',
      contentBytes: fileResponse.body,
    };
    console.log('Adding attachment: ' + att.name);
    const resp = http.post(url, {
      headers: headers,
      body: JSON.stringify(payload),
    });
    if (resp.status === 0) {
      return false;
    }
    handleError(resp, 'add attachment');
  }
  return true;
}

function handleError(response: HttpResponse, operation: string): void {
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
      const err = response.json() as {
        error?: { message?: string };
      };
      errorBody = err.error ? err.error.message || '' : response.text();
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
