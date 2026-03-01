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

// Gmail Connector - Google Gmail API v1
// This connector runs in a sandboxed environment with controlled HTTP access

const API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

const connector = {
  operations: [
    'list_messages',
    'get_message',
    'get_attachments',
    'search_messages',
    'send_message',
    'list_labels',
    'get_thread',
    'list_drafts',
    'get_attachment',
    'check_delivery',
  ],

  testConnection: function (ctx: TestConnectionContext) {
    const accessToken = ctx.secrets.get('accessToken');

    if (!accessToken) {
      throw new Error(
        'Google access token is required. Please authorize via OAuth2.',
      );
    }

    const response = ctx.http.get(API_BASE + '/profile', {
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
        'Access denied. Please verify the app has the required Gmail API scopes.',
      );
    }
    if (response.status !== 200) {
      throw new Error(
        'Gmail API connection failed (' +
          response.status +
          '): ' +
          response.text(),
      );
    }

    const profile = response.json() as Record<string, unknown>;
    return {
      status: 'ok',
      emailAddress: profile.emailAddress,
      messagesTotal: profile.messagesTotal,
    };
  },

  execute: function (ctx: ConnectorContext) {
    const operation = ctx.operation;
    const params = ctx.params;
    const http = ctx.http;
    const secrets = ctx.secrets;
    const files = ctx.files;
    const base64Encode = ctx.base64Encode;
    const base64Decode = ctx.base64Decode;

    const accessToken = secrets.get('accessToken');
    if (!accessToken) {
      throw new Error('Google access token is required.');
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
    if (operation === 'search_messages') {
      return searchMessages(http, headers, params);
    }
    if (operation === 'send_message') {
      return sendMessage(http, headers, params, base64Encode, files);
    }
    if (operation === 'list_labels') {
      return listLabels(http, headers);
    }
    if (operation === 'get_thread') {
      return getThread(http, headers, params, base64Decode);
    }
    if (operation === 'list_drafts') {
      return listDrafts(http, headers, params);
    }
    if (operation === 'get_attachment') {
      return getAttachment(http, headers, params, files);
    }
    if (operation === 'get_attachments') {
      return getAttachments(http, headers, params, files);
    }
    if (operation === 'check_delivery') {
      return checkDelivery(http, headers, params);
    }

    throw new Error('Unknown operation: ' + operation);
  },
};

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
        '. Please verify the required Google API scopes.',
    );
  }
  if (response.status === 404) {
    throw new Error('Resource not found during ' + operation + '.');
  }
  if (response.status === 429) {
    throw new Error(
      'Rate limited by Google API during ' +
        operation +
        '. Please try again later.',
    );
  }
  if (response.status >= 400) {
    let errorBody = '';
    try {
      const err = response.json() as Record<string, Record<string, string>>;
      errorBody = err.error
        ? err.error.message || JSON.stringify(err.error)
        : response.text();
    } catch (e) {
      errorBody = response.text();
    }
    throw new Error(
      'Google API error during ' +
        operation +
        ' (' +
        response.status +
        '): ' +
        errorBody,
    );
  }
}

// ---------------------------------------------------------------------------
// Email format mapping helpers (Gmail → standard email type)
// ---------------------------------------------------------------------------

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPayloadPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPayloadPart[];
}

function getGmailHeader(headers: GmailHeader[] | undefined, name: string) {
  if (!headers) return '';
  const lower = name.toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].name.toLowerCase() === lower) {
      return headers[i].value || '';
    }
  }
  return '';
}

function parseEmailAddress(str: string) {
  if (!str) return { name: '', address: '' };
  const match = str.match(/^(.*?)\s*<(.+?)>$/);
  if (match) {
    return {
      name: match[1].trim().replace(/^"|"$/g, ''),
      address: match[2],
    };
  }
  return { name: '', address: str.trim() };
}

function parseEmailAddressList(str: string) {
  if (!str) return [];
  // Split on commas that are not inside angle brackets
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  const result: Array<{ name: string; address: string }> = [];
  for (let j = 0; j < parts.length; j++) {
    result.push(parseEmailAddress(parts[j]));
  }
  return result;
}

function base64UrlDecodeString(
  data: string,
  base64Decode: (input: string) => string,
) {
  if (!data) return '';
  let base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';
  if (base64Decode) {
    return base64Decode(base64);
  }
  return '';
}

function extractBodyPart(
  payload: GmailPayloadPart | undefined,
  mimeType: string,
  base64Decode: (input: string) => string,
): string {
  if (!payload) return '';
  if (payload.mimeType === mimeType && payload.body && payload.body.data) {
    return base64UrlDecodeString(payload.body.data, base64Decode);
  }
  if (payload.parts) {
    for (let i = 0; i < payload.parts.length; i++) {
      const result = extractBodyPart(payload.parts[i], mimeType, base64Decode);
      if (result) return result;
    }
  }
  return '';
}

function getGmailAccountEmail(http: HttpApi, headers: Record<string, string>) {
  const response = http.get(API_BASE + '/profile', { headers: headers });
  if (response.status === 200) {
    return (response.json() as Record<string, string>).emailAddress || '';
  }
  return '';
}

interface GmailMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPayloadPart;
}

function mapGmailToEmailType(
  msg: GmailMessage,
  accountEmail: string,
  base64Decode: (input: string) => string,
) {
  const hdrs = msg.payload ? (msg.payload.headers as GmailHeader[]) : [];
  const fromStr = getGmailHeader(hdrs, 'From');
  const fromParsed = parseEmailAddress(fromStr);
  const senderAddr = (fromParsed.address || '').toLowerCase();
  const direction =
    accountEmail && senderAddr === accountEmail.toLowerCase()
      ? 'outbound'
      : 'inbound';

  const attachmentParts = findAttachmentParts(msg.payload || {}, []);

  return {
    uid: 0,
    messageId: msg.id || '',
    from: [fromParsed],
    to: parseEmailAddressList(getGmailHeader(hdrs, 'To')),
    cc: parseEmailAddressList(getGmailHeader(hdrs, 'Cc')),
    bcc: parseEmailAddressList(getGmailHeader(hdrs, 'Bcc')),
    subject: getGmailHeader(hdrs, 'Subject') || '',
    date: getGmailHeader(hdrs, 'Date') || msg.internalDate || '',
    text: extractBodyPart(msg.payload, 'text/plain', base64Decode),
    html: extractBodyPart(msg.payload, 'text/html', base64Decode),
    flags:
      msg.labelIds && msg.labelIds.indexOf('UNREAD') === -1 ? ['\\Seen'] : [],
    headers: {
      'message-id': getGmailHeader(hdrs, 'Message-ID') || '',
      'in-reply-to': getGmailHeader(hdrs, 'In-Reply-To') || '',
      references: getGmailHeader(hdrs, 'References') || '',
    },
    attachments: attachmentParts.map(function (part) {
      const contentIdHeader = getGmailHeader(
        part.headers as GmailHeader[],
        'Content-ID',
      );
      const contentId = contentIdHeader
        ? contentIdHeader.replace(/^<|>$/g, '')
        : '';
      const att: Record<string, unknown> = {
        id: part.body ? part.body.attachmentId : '',
        filename: part.filename || 'attachment',
        contentType: part.mimeType || 'application/octet-stream',
        size: part.body ? part.body.size || 0 : 0,
      };
      if (contentId) {
        att.contentId = contentId;
      }
      return att;
    }),
    hasAttachments: attachmentParts.length > 0,
    conversationId: msg.threadId || '',
    direction: direction,
  };
}

// ---------------------------------------------------------------------------

function listMessages(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const maxResults = Math.min((params.maxResults as number) || 25, 500);
  const queryParts = ['maxResults=' + maxResults];

  // Exclude draft messages — drafts should never enter the sync pipeline
  let q = (params.q as string) || '';
  if (q.indexOf('is:draft') === -1 && q.indexOf('label:draft') === -1) {
    q = q ? q + ' -is:draft' : '-is:draft';
  }
  if (q) {
    queryParts.push('q=' + encodeURIComponent(q));
  }
  if (params.pageToken) {
    queryParts.push(
      'pageToken=' + encodeURIComponent(params.pageToken as string),
    );
  }
  if (params.labelIds) {
    const labels = (params.labelIds as string).split(',');
    for (let i = 0; i < labels.length; i++) {
      queryParts.push('labelIds=' + encodeURIComponent(labels[i].trim()));
    }
  }

  const url = API_BASE + '/messages?' + queryParts.join('&');
  console.log('Listing messages: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list messages');

  const data = response.json() as Record<string, unknown>;
  const messages = data.messages as unknown[] | undefined;
  return {
    success: true,
    operation: 'list_messages',
    data: messages || [],
    count: messages ? messages.length : 0,
    resultSizeEstimate: (data.resultSizeEstimate as number) || 0,
    pagination: {
      hasNextPage: !!data.nextPageToken,
      nextPageToken: data.nextPageToken || null,
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

  const format = (params.format as string) || 'full';
  const url =
    API_BASE +
    '/messages/' +
    encodeURIComponent(params.messageId as string) +
    '?format=' +
    encodeURIComponent(format);
  console.log('Fetching message: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'get message');

  const message = response.json() as Record<string, unknown>;

  if (params.includeAttachments && files && message.payload) {
    const attachmentParts = findAttachmentParts(
      message.payload as GmailPayloadPart,
      [],
    );
    if (attachmentParts.length > 0) {
      const attachmentFiles = [];
      for (let i = 0; i < attachmentParts.length; i++) {
        const part = attachmentParts[i];
        if (part.body && part.body.attachmentId) {
          const file = downloadAndStoreAttachment(
            http,
            headers,
            files,
            params.messageId as string,
            part.body.attachmentId,
            part.filename || 'attachment',
            part.mimeType || 'application/octet-stream',
            part.body.size || 0,
          );
          attachmentFiles.push(file);
        }
      }
      message.attachmentFiles = attachmentFiles;
    }
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

  const maxResults = Math.min((params.maxResults as number) || 25, 500);
  const queryParts = [
    'q=' + encodeURIComponent(params.query as string),
    'maxResults=' + maxResults,
  ];

  if (params.pageToken) {
    queryParts.push(
      'pageToken=' + encodeURIComponent(params.pageToken as string),
    );
  }

  const url = API_BASE + '/messages?' + queryParts.join('&');
  console.log('Searching messages: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'search messages');

  const data = response.json() as Record<string, unknown>;
  const messages = data.messages as unknown[] | undefined;
  return {
    success: true,
    operation: 'search_messages',
    data: messages || [],
    count: messages ? messages.length : 0,
    resultSizeEstimate: (data.resultSizeEstimate as number) || 0,
    pagination: {
      hasNextPage: !!data.nextPageToken,
      nextPageToken: data.nextPageToken || null,
    },
    timestamp: Date.now(),
  };
}

function toMimeContentType(contentType: string | undefined) {
  if (!contentType) return 'text/plain';
  const lower = contentType.toLowerCase();
  if (lower === 'html' || lower === 'text/html') return 'text/html';
  if (lower === 'text' || lower === 'text/plain') return 'text/plain';
  return contentType;
}

function hasNonAscii(str: string) {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 127) return true;
  }
  return false;
}

function encodeRfc2047(text: string, base64Encode: (input: string) => string) {
  if (!text || !hasNonAscii(text)) return text;
  return '=?UTF-8?B?' + base64Encode(text) + '?=';
}

function formatReferences(refs: unknown, fallback: string) {
  if (Array.isArray(refs)) return refs.join(' ');
  return (refs as string) || fallback;
}

interface MimeParams {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body?: string;
  contentType?: string;
  inReplyTo?: string | null;
  references?: unknown;
}

function buildSimpleMimeMessage(
  params: MimeParams,
  base64Encode: (input: string) => string,
) {
  const lines: string[] = [];
  lines.push('To: ' + params.to);
  if (params.cc) lines.push('Cc: ' + params.cc);
  if (params.bcc) lines.push('Bcc: ' + params.bcc);
  lines.push('Subject: ' + encodeRfc2047(params.subject, base64Encode));
  if (params.inReplyTo) {
    lines.push('In-Reply-To: ' + params.inReplyTo);
    lines.push(
      'References: ' + formatReferences(params.references, params.inReplyTo),
    );
  }
  lines.push('MIME-Version: 1.0');
  lines.push(
    'Content-Type: ' +
      toMimeContentType(params.contentType) +
      '; charset=utf-8',
  );
  lines.push('');
  lines.push(params.body || '');
  return lines.join('\r\n');
}

interface AttachmentData {
  name: string;
  contentType?: string;
  base64Data: string;
}

function buildMimeWithAttachments(
  params: MimeParams,
  attachmentDataList: AttachmentData[],
  base64Encode: (input: string) => string,
) {
  const boundary = 'boundary_' + Date.now() + '_tale';
  const lines: string[] = [];
  lines.push('To: ' + params.to);
  if (params.cc) lines.push('Cc: ' + params.cc);
  if (params.bcc) lines.push('Bcc: ' + params.bcc);
  lines.push('Subject: ' + encodeRfc2047(params.subject, base64Encode));
  if (params.inReplyTo) {
    lines.push('In-Reply-To: ' + params.inReplyTo);
    lines.push(
      'References: ' + formatReferences(params.references, params.inReplyTo),
    );
  }
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: multipart/mixed; boundary="' + boundary + '"');
  lines.push('');
  // Text body part
  lines.push('--' + boundary);
  lines.push(
    'Content-Type: ' +
      toMimeContentType(params.contentType) +
      '; charset=utf-8',
  );
  lines.push('');
  lines.push(params.body || '');
  // Attachment parts
  for (let i = 0; i < attachmentDataList.length; i++) {
    const att = attachmentDataList[i];
    lines.push('--' + boundary);
    lines.push(
      'Content-Type: ' +
        (att.contentType || 'application/octet-stream') +
        '; name="' +
        att.name +
        '"',
    );
    lines.push('Content-Disposition: attachment; filename="' + att.name + '"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(att.base64Data);
  }
  lines.push('--' + boundary + '--');
  return lines.join('\r\n');
}

function base64UrlEncode(base64Encode: (input: string) => string, str: string) {
  const b64 = base64Encode(str);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sendMessage(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
  base64Encode: (input: string) => string,
  files: FilesApi | undefined,
) {
  if (!params.to) {
    throw new Error('to (recipient email address) is required.');
  }
  if (!params.subject) {
    throw new Error('subject is required.');
  }

  // Resolve threadId and inReplyTo into local variables.
  // IMPORTANT: never mutate params — the sandbox re-runs this function on each
  // pass and uses a sequential counter for HTTP request caching. If we mutate
  // params (e.g. setting params.threadId), a conditional branch may be skipped
  // on the next pass, shifting the counter and returning wrong cached responses.
  let threadId = (params.threadId as string) || null;
  let inReplyTo = (params.inReplyTo as string) || null;

  if (params.inReplyTo && !params.threadId) {
    const isRfc2822 = (params.inReplyTo as string).indexOf('<') !== -1;

    if (isRfc2822) {
      // RFC 2822 Message-ID — search by rfc822msgid
      const searchUrl =
        API_BASE +
        '/messages?q=rfc822msgid:' +
        encodeURIComponent(params.inReplyTo as string) +
        '&maxResults=1';
      const searchResponse = http.get(searchUrl, { headers: headers });
      if (searchResponse.status === 200) {
        const searchData = searchResponse.json() as Record<string, unknown>;
        const searchMessages = searchData.messages as
          | Array<{ threadId: string }>
          | undefined;
        if (searchMessages && searchMessages.length > 0) {
          threadId = searchMessages[0].threadId;
        }
      }
    } else {
      // Gmail internal ID — fetch the message directly to get threadId
      // and resolve the RFC 2822 Message-ID for proper MIME threading headers
      const lookupUrl =
        API_BASE +
        '/messages/' +
        encodeURIComponent(params.inReplyTo as string) +
        '?format=metadata&metadataHeaders=Message-ID';
      const lookupResponse = http.get(lookupUrl, { headers: headers });
      if (lookupResponse.status === 200) {
        const lookupData = lookupResponse.json() as Record<string, unknown>;
        threadId = lookupData.threadId as string;
        const lookupPayload = lookupData.payload as
          | { headers?: GmailHeader[] }
          | undefined;
        const rfc2822Id = getGmailHeader(
          lookupPayload ? lookupPayload.headers : [],
          'Message-ID',
        );
        if (rfc2822Id) {
          inReplyTo = rfc2822Id;
        }
      }
    }
  }

  // Build MIME params with resolved threading values (not mutating original params)
  const mimeParams: MimeParams = {
    to: params.to as string,
    cc: params.cc as string | undefined,
    bcc: params.bcc as string | undefined,
    subject: params.subject as string,
    body: params.body as string | undefined,
    contentType: params.contentType as string | undefined,
    inReplyTo: inReplyTo,
    references: params.references,
  };

  const attachments = params.attachments as
    | Array<{ url: string; name: string; contentType?: string }>
    | undefined;
  const hasAttachments = attachments && attachments.length > 0 && files;

  let mimeMessage: string;
  if (hasAttachments) {
    const attachmentDataList = downloadAttachmentsForSend(http, attachments);
    mimeMessage = buildMimeWithAttachments(
      mimeParams,
      attachmentDataList,
      base64Encode,
    );
  } else {
    mimeMessage = buildSimpleMimeMessage(mimeParams, base64Encode);
  }

  const raw = base64UrlEncode(base64Encode, mimeMessage);

  const body: Record<string, unknown> = { raw: raw };
  if (threadId) {
    body.threadId = threadId;
  }

  const url = API_BASE + '/messages/send';
  console.log('Sending message via: ' + url);

  const response = http.post(url, {
    headers: headers,
    body: JSON.stringify(body),
  });
  handleError(response, 'send message');

  const sent = response.json() as Record<string, unknown>;

  // Fetch the sent message to extract the RFC 2822 Message-ID header,
  // which is needed for delivery tracking and threading.
  let internetMessageId = '';
  if (sent.id) {
    const metaUrl =
      API_BASE +
      '/messages/' +
      encodeURIComponent(sent.id as string) +
      '?format=metadata&metadataHeaders=Message-ID';
    const metaResponse = http.get(metaUrl, { headers: headers });
    if (metaResponse.status === 200) {
      const metaData = metaResponse.json() as Record<string, unknown>;
      const metaPayload = metaData.payload as
        | { headers?: GmailHeader[] }
        | undefined;
      internetMessageId = getGmailHeader(
        metaPayload ? metaPayload.headers : [],
        'Message-ID',
      );
    }
  }

  return {
    success: true,
    operation: 'send_message',
    data: {
      id: sent.id,
      threadId: sent.threadId,
      labelIds: sent.labelIds,
      internetMessageId: internetMessageId,
      to: params.to,
      subject: params.subject,
      isReply: !!threadId,
    },
    count: 1,
    timestamp: Date.now(),
  };
}

function downloadAttachmentsForSend(
  http: HttpApi,
  attachments: Array<{ url: string; name: string; contentType?: string }>,
) {
  const result: AttachmentData[] = [];
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    if (!att.url) {
      throw new Error('Attachment "' + (att.name || i) + '" is missing a url.');
    }
    const fileResponse = http.get(att.url, { responseType: 'base64' });
    if (fileResponse.status !== 200) {
      throw new Error(
        'Failed to download attachment "' +
          att.name +
          '" (' +
          fileResponse.status +
          ')',
      );
    }
    result.push({
      name: att.name || 'attachment',
      contentType: att.contentType || 'application/octet-stream',
      base64Data: fileResponse.body as string,
    });
  }
  return result;
}

function listLabels(http: HttpApi, headers: Record<string, string>) {
  const url = API_BASE + '/labels';
  console.log('Listing labels: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list labels');

  const data = response.json() as Record<string, unknown>;
  const labels = data.labels as unknown[] | undefined;
  return {
    success: true,
    operation: 'list_labels',
    data: labels || [],
    count: labels ? labels.length : 0,
    timestamp: Date.now(),
  };
}

function getThread(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
  base64Decode: (input: string) => string,
) {
  if (!params.threadId) {
    throw new Error('threadId is required.');
  }

  // Always fetch full format from API to have payload available
  const apiFormat =
    params.format === 'email' ? 'full' : (params.format as string) || 'full';
  const url =
    API_BASE +
    '/threads/' +
    encodeURIComponent(params.threadId as string) +
    '?format=' +
    encodeURIComponent(apiFormat);
  console.log('Fetching thread: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'get thread');

  const thread = response.json() as Record<string, unknown>;

  if (params.format === 'email') {
    const accountEmail = getGmailAccountEmail(http, headers);
    const messages = (thread.messages || []) as GmailMessage[];
    const mapped = [];
    for (let i = 0; i < messages.length; i++) {
      // Skip draft messages — they should not be synced into conversations
      if (
        messages[i].labelIds &&
        messages[i].labelIds!.indexOf('DRAFT') !== -1
      ) {
        continue;
      }
      mapped.push(mapGmailToEmailType(messages[i], accountEmail, base64Decode));
    }
    return {
      success: true,
      operation: 'get_thread',
      data: mapped,
      count: mapped.length,
      threadId: thread.id,
      timestamp: Date.now(),
    };
  }

  return {
    success: true,
    operation: 'get_thread',
    data: thread,
    count: (thread.messages as unknown[])
      ? (thread.messages as unknown[]).length
      : 1,
    timestamp: Date.now(),
  };
}

function listDrafts(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const maxResults = Math.min((params.maxResults as number) || 25, 500);
  const queryParts = ['maxResults=' + maxResults];

  if (params.pageToken) {
    queryParts.push(
      'pageToken=' + encodeURIComponent(params.pageToken as string),
    );
  }

  const url = API_BASE + '/drafts?' + queryParts.join('&');
  console.log('Listing drafts: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list drafts');

  const data = response.json() as Record<string, unknown>;
  const drafts = data.drafts as unknown[] | undefined;
  return {
    success: true,
    operation: 'list_drafts',
    data: drafts || [],
    count: drafts ? drafts.length : 0,
    resultSizeEstimate: (data.resultSizeEstimate as number) || 0,
    pagination: {
      hasNextPage: !!data.nextPageToken,
      nextPageToken: data.nextPageToken || null,
    },
    timestamp: Date.now(),
  };
}

function getAttachment(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
  files: FilesApi | undefined,
) {
  if (!params.messageId) {
    throw new Error('messageId is required.');
  }
  if (!params.attachmentId) {
    throw new Error('attachmentId is required.');
  }
  if (!files) {
    throw new Error(
      'File storage is not available. The ctx.files API is required for attachment operations.',
    );
  }

  const url =
    API_BASE +
    '/messages/' +
    encodeURIComponent(params.messageId as string) +
    '/attachments/' +
    encodeURIComponent(params.attachmentId as string);
  console.log('Fetching attachment: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'get attachment');

  const data = response.json() as Record<string, unknown>;
  const base64UrlData = (data.data as string) || '';

  let base64Standard = base64UrlData.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64Standard.length % 4;
  if (padding === 2) {
    base64Standard += '==';
  } else if (padding === 3) {
    base64Standard += '=';
  }

  const storedFile = files.store(base64Standard, {
    encoding: 'base64',
    contentType: (params.contentType as string) || 'application/octet-stream',
    fileName:
      (params.fileName as string) || 'attachment-' + params.attachmentId,
  });

  return {
    success: true,
    operation: 'get_attachment',
    data: {
      attachmentId: data.attachmentId || params.attachmentId,
      size: data.size || 0,
      fileId: storedFile.fileId,
      url: storedFile.url,
    },
    count: 1,
    timestamp: Date.now(),
  };
}

// Recursively find all parts with attachmentId in a Gmail message payload.
function findAttachmentParts(
  part: GmailPayloadPart,
  result: GmailPayloadPart[],
) {
  if (part.body && part.body.attachmentId) {
    result.push(part);
  }
  if (part.parts) {
    for (let i = 0; i < part.parts.length; i++) {
      findAttachmentParts(part.parts[i], result);
    }
  }
  return result;
}

// Download a single attachment and store it via the files API.
function downloadAndStoreAttachment(
  http: HttpApi,
  headers: Record<string, string>,
  files: FilesApi,
  messageId: string,
  attachmentId: string,
  fileName: string,
  contentType: string,
  size: number,
) {
  const url =
    API_BASE +
    '/messages/' +
    encodeURIComponent(messageId) +
    '/attachments/' +
    encodeURIComponent(attachmentId);

  const response = http.get(url, { headers: headers });
  handleError(response, 'get attachment');

  const data = response.json() as Record<string, string>;
  const base64UrlData = data.data || '';

  let base64Standard = base64UrlData.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64Standard.length % 4;
  if (padding === 2) {
    base64Standard += '==';
  } else if (padding === 3) {
    base64Standard += '=';
  }

  const storedFile = files.store(base64Standard, {
    encoding: 'base64',
    contentType: contentType,
    fileName: fileName,
  });

  return {
    id: attachmentId,
    name: fileName,
    contentType: contentType,
    size: size,
    fileId: storedFile.fileId,
    url: storedFile.url,
  };
}

// Download all file attachments from a message and store them.
function getAttachments(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
  files: FilesApi | undefined,
) {
  if (!params.messageId) {
    throw new Error('messageId is required.');
  }
  if (!files) {
    throw new Error(
      'File storage is not available. The ctx.files API is required for attachment operations.',
    );
  }

  // Fetch the message to discover attachment parts
  const msgUrl =
    API_BASE +
    '/messages/' +
    encodeURIComponent(params.messageId as string) +
    '?format=full';
  const msgResponse = http.get(msgUrl, { headers: headers });
  handleError(msgResponse, 'get message for attachments');

  const message = msgResponse.json() as Record<string, unknown>;
  const attachmentParts = findAttachmentParts(
    (message.payload as GmailPayloadPart) || {},
    [],
  );
  const attachments: Array<Record<string, unknown>> = [];

  for (let i = 0; i < attachmentParts.length; i++) {
    const part = attachmentParts[i];
    if (part.body && part.body.attachmentId) {
      const file = downloadAndStoreAttachment(
        http,
        headers,
        files,
        params.messageId as string,
        part.body.attachmentId,
        part.filename || 'attachment',
        part.mimeType || 'application/octet-stream',
        part.body.size || 0,
      );
      const cidHeader = getGmailHeader(
        part.headers as GmailHeader[],
        'Content-ID',
      );
      if (cidHeader) {
        (file as Record<string, unknown>).contentId = cidHeader.replace(
          /^<|>$/g,
          '',
        );
      }
      attachments.push(file);
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

// Check whether a sent message has been delivered.
// Accepts either an RFC 2822 Message-ID or a Gmail internal message ID.
function checkDelivery(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  if (!params.internetMessageId) {
    throw new Error('internetMessageId is required.');
  }

  const isRfc2822 = (params.internetMessageId as string).indexOf('<') !== -1;
  let delivered = false;

  if (isRfc2822) {
    const searchUrl =
      API_BASE +
      '/messages?q=rfc822msgid:' +
      encodeURIComponent(params.internetMessageId as string) +
      '&maxResults=1';
    const searchResponse = http.get(searchUrl, { headers: headers });
    handleError(searchResponse, 'check delivery');
    const searchData = searchResponse.json() as Record<string, unknown>;
    const searchMessages = searchData.messages as unknown[] | undefined;
    delivered = !!(searchMessages && searchMessages.length > 0);
  } else {
    const msgUrl =
      API_BASE +
      '/messages/' +
      encodeURIComponent(params.internetMessageId as string) +
      '?format=minimal';
    const msgResponse = http.get(msgUrl, { headers: headers });
    delivered = msgResponse.status === 200;
  }

  return {
    success: true,
    operation: 'check_delivery',
    data: {
      delivered: delivered,
      internetMessageId: params.internetMessageId,
    },
    count: delivered ? 1 : 0,
    timestamp: Date.now(),
  };
}
