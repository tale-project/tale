// Gmail Connector - Google Gmail API v1
// This connector runs in a sandboxed environment with controlled HTTP access

var API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

var connector = {
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

  testConnection: function (ctx) {
    var accessToken = ctx.secrets.get('accessToken');

    if (!accessToken) {
      throw new Error(
        'Google access token is required. Please authorize via OAuth2.',
      );
    }

    var response = ctx.http.get(API_BASE + '/profile', {
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

    var profile = response.json();
    return {
      status: 'ok',
      emailAddress: profile.emailAddress,
      messagesTotal: profile.messagesTotal,
    };
  },

  execute: function (ctx) {
    var operation = ctx.operation;
    var params = ctx.params;
    var http = ctx.http;
    var secrets = ctx.secrets;
    var files = ctx.files;
    var base64Encode = ctx.base64Encode;
    var base64Decode = ctx.base64Decode;

    var accessToken = secrets.get('accessToken');
    if (!accessToken) {
      throw new Error('Google access token is required.');
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
    var errorBody = '';
    try {
      var err = response.json();
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

function getGmailHeader(headers, name) {
  if (!headers) return '';
  var lower = name.toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (headers[i].name.toLowerCase() === lower) {
      return headers[i].value || '';
    }
  }
  return '';
}

function parseEmailAddress(str) {
  if (!str) return { name: '', address: '' };
  var match = str.match(/^(.*?)\s*<(.+?)>$/);
  if (match) {
    return {
      name: match[1].trim().replace(/^"|"$/g, ''),
      address: match[2],
    };
  }
  return { name: '', address: str.trim() };
}

function parseEmailAddressList(str) {
  if (!str) return [];
  // Split on commas that are not inside angle brackets
  var parts = [];
  var depth = 0;
  var current = '';
  for (var i = 0; i < str.length; i++) {
    var ch = str[i];
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
  var result = [];
  for (var j = 0; j < parts.length; j++) {
    result.push(parseEmailAddress(parts[j]));
  }
  return result;
}

function base64UrlDecodeString(data, base64Decode) {
  if (!data) return '';
  var base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  var pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';
  if (base64Decode) {
    return base64Decode(base64);
  }
  return '';
}

function extractBodyPart(payload, mimeType, base64Decode) {
  if (!payload) return '';
  if (payload.mimeType === mimeType && payload.body && payload.body.data) {
    return base64UrlDecodeString(payload.body.data, base64Decode);
  }
  if (payload.parts) {
    for (var i = 0; i < payload.parts.length; i++) {
      var result = extractBodyPart(payload.parts[i], mimeType, base64Decode);
      if (result) return result;
    }
  }
  return '';
}

function getGmailAccountEmail(http, headers) {
  var response = http.get(API_BASE + '/profile', { headers: headers });
  if (response.status === 200) {
    return response.json().emailAddress || '';
  }
  return '';
}

function mapGmailToEmailType(msg, accountEmail, base64Decode) {
  var hdrs = msg.payload ? msg.payload.headers : [];
  var fromStr = getGmailHeader(hdrs, 'From');
  var fromParsed = parseEmailAddress(fromStr);
  var senderAddr = (fromParsed.address || '').toLowerCase();
  var direction =
    accountEmail && senderAddr === accountEmail.toLowerCase()
      ? 'outbound'
      : 'inbound';

  var attachmentParts = findAttachmentParts(msg.payload || {}, []);

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
      return {
        id: part.body ? part.body.attachmentId : '',
        filename: part.filename || 'attachment',
        contentType: part.mimeType || 'application/octet-stream',
        size: part.body ? part.body.size || 0 : 0,
      };
    }),
    hasAttachments: attachmentParts.length > 0,
    conversationId: msg.threadId || '',
    direction: direction,
  };
}

// ---------------------------------------------------------------------------

function listMessages(http, headers, params) {
  var maxResults = Math.min(params.maxResults || 25, 500);
  var queryParts = ['maxResults=' + maxResults];

  if (params.q) {
    queryParts.push('q=' + encodeURIComponent(params.q));
  }
  if (params.pageToken) {
    queryParts.push('pageToken=' + encodeURIComponent(params.pageToken));
  }
  if (params.labelIds) {
    var labels = params.labelIds.split(',');
    for (var i = 0; i < labels.length; i++) {
      queryParts.push('labelIds=' + encodeURIComponent(labels[i].trim()));
    }
  }

  var url = API_BASE + '/messages?' + queryParts.join('&');
  console.log('Listing messages: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list messages');

  var data = response.json();
  return {
    success: true,
    operation: 'list_messages',
    data: data.messages || [],
    count: data.messages ? data.messages.length : 0,
    resultSizeEstimate: data.resultSizeEstimate || 0,
    pagination: {
      hasNextPage: !!data.nextPageToken,
      nextPageToken: data.nextPageToken || null,
    },
    timestamp: Date.now(),
  };
}

function getMessage(http, headers, params, files) {
  if (!params.messageId) {
    throw new Error('messageId is required.');
  }

  var format = params.format || 'full';
  var url =
    API_BASE +
    '/messages/' +
    encodeURIComponent(params.messageId) +
    '?format=' +
    encodeURIComponent(format);
  console.log('Fetching message: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'get message');

  var message = response.json();

  if (params.includeAttachments && files && message.payload) {
    var attachmentParts = findAttachmentParts(message.payload, []);
    if (attachmentParts.length > 0) {
      var attachmentFiles = [];
      for (var i = 0; i < attachmentParts.length; i++) {
        var part = attachmentParts[i];
        if (part.body && part.body.attachmentId) {
          var file = downloadAndStoreAttachment(
            http,
            headers,
            files,
            params.messageId,
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

function searchMessages(http, headers, params) {
  if (!params.query) {
    throw new Error('query is required for searching messages.');
  }

  var maxResults = Math.min(params.maxResults || 25, 500);
  var queryParts = [
    'q=' + encodeURIComponent(params.query),
    'maxResults=' + maxResults,
  ];

  if (params.pageToken) {
    queryParts.push('pageToken=' + encodeURIComponent(params.pageToken));
  }

  var url = API_BASE + '/messages?' + queryParts.join('&');
  console.log('Searching messages: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'search messages');

  var data = response.json();
  return {
    success: true,
    operation: 'search_messages',
    data: data.messages || [],
    count: data.messages ? data.messages.length : 0,
    resultSizeEstimate: data.resultSizeEstimate || 0,
    pagination: {
      hasNextPage: !!data.nextPageToken,
      nextPageToken: data.nextPageToken || null,
    },
    timestamp: Date.now(),
  };
}

function toMimeContentType(contentType) {
  if (!contentType) return 'text/plain';
  var lower = contentType.toLowerCase();
  if (lower === 'html' || lower === 'text/html') return 'text/html';
  if (lower === 'text' || lower === 'text/plain') return 'text/plain';
  return contentType;
}

function hasNonAscii(str) {
  for (var i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 127) return true;
  }
  return false;
}

function encodeRfc2047(text, base64Encode) {
  if (!text || !hasNonAscii(text)) return text;
  return '=?UTF-8?B?' + base64Encode(text) + '?=';
}

function formatReferences(refs, fallback) {
  if (Array.isArray(refs)) return refs.join(' ');
  return refs || fallback;
}

function buildSimpleMimeMessage(params, base64Encode) {
  var lines = [];
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

function buildMimeWithAttachments(params, attachmentDataList, base64Encode) {
  var boundary = 'boundary_' + Date.now() + '_tale';
  var lines = [];
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
  for (var i = 0; i < attachmentDataList.length; i++) {
    var att = attachmentDataList[i];
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

function base64UrlEncode(base64Encode, str) {
  var b64 = base64Encode(str);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sendMessage(http, headers, params, base64Encode, files) {
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
  var threadId = params.threadId || null;
  var inReplyTo = params.inReplyTo || null;

  if (params.inReplyTo && !params.threadId) {
    var isRfc2822 = params.inReplyTo.indexOf('<') !== -1;

    if (isRfc2822) {
      // RFC 2822 Message-ID — search by rfc822msgid
      var searchUrl =
        API_BASE +
        '/messages?q=rfc822msgid:' +
        encodeURIComponent(params.inReplyTo) +
        '&maxResults=1';
      var searchResponse = http.get(searchUrl, { headers: headers });
      if (searchResponse.status === 200) {
        var searchData = searchResponse.json();
        if (searchData.messages && searchData.messages.length > 0) {
          threadId = searchData.messages[0].threadId;
        }
      }
    } else {
      // Gmail internal ID — fetch the message directly to get threadId
      // and resolve the RFC 2822 Message-ID for proper MIME threading headers
      var lookupUrl =
        API_BASE +
        '/messages/' +
        encodeURIComponent(params.inReplyTo) +
        '?format=metadata&metadataHeaders=Message-ID';
      var lookupResponse = http.get(lookupUrl, { headers: headers });
      if (lookupResponse.status === 200) {
        var lookupData = lookupResponse.json();
        threadId = lookupData.threadId;
        var rfc2822Id = getGmailHeader(
          lookupData.payload ? lookupData.payload.headers : [],
          'Message-ID',
        );
        if (rfc2822Id) {
          inReplyTo = rfc2822Id;
        }
      }
    }
  }

  // Build MIME params with resolved threading values (not mutating original params)
  var mimeParams = {
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    body: params.body,
    contentType: params.contentType,
    inReplyTo: inReplyTo,
    references: params.references,
  };

  var hasAttachments =
    params.attachments && params.attachments.length > 0 && files;

  var mimeMessage;
  if (hasAttachments) {
    var attachmentDataList = downloadAttachmentsForSend(
      http,
      params.attachments,
    );
    mimeMessage = buildMimeWithAttachments(
      mimeParams,
      attachmentDataList,
      base64Encode,
    );
  } else {
    mimeMessage = buildSimpleMimeMessage(mimeParams, base64Encode);
  }

  var raw = base64UrlEncode(base64Encode, mimeMessage);

  var body = { raw: raw };
  if (threadId) {
    body.threadId = threadId;
  }

  var url = API_BASE + '/messages/send';
  console.log('Sending message via: ' + url);

  var response = http.post(url, {
    headers: headers,
    body: JSON.stringify(body),
  });
  handleError(response, 'send message');

  var sent = response.json();

  // Fetch the sent message to extract the RFC 2822 Message-ID header,
  // which is needed for delivery tracking and threading.
  var internetMessageId = '';
  if (sent.id) {
    var metaUrl =
      API_BASE +
      '/messages/' +
      encodeURIComponent(sent.id) +
      '?format=metadata&metadataHeaders=Message-ID';
    var metaResponse = http.get(metaUrl, { headers: headers });
    if (metaResponse.status === 200) {
      var metaData = metaResponse.json();
      internetMessageId = getGmailHeader(
        metaData.payload ? metaData.payload.headers : [],
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

function downloadAttachmentsForSend(http, attachments) {
  var result = [];
  for (var i = 0; i < attachments.length; i++) {
    var att = attachments[i];
    if (!att.url) {
      throw new Error('Attachment "' + (att.name || i) + '" is missing a url.');
    }
    var fileResponse = http.get(att.url, { responseType: 'base64' });
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
      base64Data: fileResponse.body,
    });
  }
  return result;
}

function listLabels(http, headers) {
  var url = API_BASE + '/labels';
  console.log('Listing labels: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list labels');

  var data = response.json();
  return {
    success: true,
    operation: 'list_labels',
    data: data.labels || [],
    count: data.labels ? data.labels.length : 0,
    timestamp: Date.now(),
  };
}

function getThread(http, headers, params, base64Decode) {
  if (!params.threadId) {
    throw new Error('threadId is required.');
  }

  // Always fetch full format from API to have payload available
  var apiFormat = params.format === 'email' ? 'full' : params.format || 'full';
  var url =
    API_BASE +
    '/threads/' +
    encodeURIComponent(params.threadId) +
    '?format=' +
    encodeURIComponent(apiFormat);
  console.log('Fetching thread: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'get thread');

  var thread = response.json();

  if (params.format === 'email') {
    var accountEmail = getGmailAccountEmail(http, headers);
    var messages = thread.messages || [];
    var mapped = [];
    for (var i = 0; i < messages.length; i++) {
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
    count: thread.messages ? thread.messages.length : 1,
    timestamp: Date.now(),
  };
}

function listDrafts(http, headers, params) {
  var maxResults = Math.min(params.maxResults || 25, 500);
  var queryParts = ['maxResults=' + maxResults];

  if (params.pageToken) {
    queryParts.push('pageToken=' + encodeURIComponent(params.pageToken));
  }

  var url = API_BASE + '/drafts?' + queryParts.join('&');
  console.log('Listing drafts: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'list drafts');

  var data = response.json();
  return {
    success: true,
    operation: 'list_drafts',
    data: data.drafts || [],
    count: data.drafts ? data.drafts.length : 0,
    resultSizeEstimate: data.resultSizeEstimate || 0,
    pagination: {
      hasNextPage: !!data.nextPageToken,
      nextPageToken: data.nextPageToken || null,
    },
    timestamp: Date.now(),
  };
}

function getAttachment(http, headers, params, files) {
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

  var url =
    API_BASE +
    '/messages/' +
    encodeURIComponent(params.messageId) +
    '/attachments/' +
    encodeURIComponent(params.attachmentId);
  console.log('Fetching attachment: ' + url);

  var response = http.get(url, { headers: headers });
  handleError(response, 'get attachment');

  var data = response.json();
  var base64UrlData = data.data || '';

  var base64Standard = base64UrlData.replace(/-/g, '+').replace(/_/g, '/');
  var padding = base64Standard.length % 4;
  if (padding === 2) {
    base64Standard += '==';
  } else if (padding === 3) {
    base64Standard += '=';
  }

  var storedFile = files.store(base64Standard, {
    encoding: 'base64',
    contentType: params.contentType || 'application/octet-stream',
    fileName: params.fileName || 'attachment-' + params.attachmentId,
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
function findAttachmentParts(part, result) {
  if (part.body && part.body.attachmentId) {
    result.push(part);
  }
  if (part.parts) {
    for (var i = 0; i < part.parts.length; i++) {
      findAttachmentParts(part.parts[i], result);
    }
  }
  return result;
}

// Download a single attachment and store it via the files API.
function downloadAndStoreAttachment(
  http,
  headers,
  files,
  messageId,
  attachmentId,
  fileName,
  contentType,
  size,
) {
  var url =
    API_BASE +
    '/messages/' +
    encodeURIComponent(messageId) +
    '/attachments/' +
    encodeURIComponent(attachmentId);

  var response = http.get(url, { headers: headers });
  handleError(response, 'get attachment');

  var data = response.json();
  var base64UrlData = data.data || '';

  var base64Standard = base64UrlData.replace(/-/g, '+').replace(/_/g, '/');
  var padding = base64Standard.length % 4;
  if (padding === 2) {
    base64Standard += '==';
  } else if (padding === 3) {
    base64Standard += '=';
  }

  var storedFile = files.store(base64Standard, {
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
function getAttachments(http, headers, params, files) {
  if (!params.messageId) {
    throw new Error('messageId is required.');
  }
  if (!files) {
    throw new Error(
      'File storage is not available. The ctx.files API is required for attachment operations.',
    );
  }

  // Fetch the message to discover attachment parts
  var msgUrl =
    API_BASE +
    '/messages/' +
    encodeURIComponent(params.messageId) +
    '?format=full';
  var msgResponse = http.get(msgUrl, { headers: headers });
  handleError(msgResponse, 'get message for attachments');

  var message = msgResponse.json();
  var attachmentParts = findAttachmentParts(message.payload || {}, []);
  var attachments = [];

  for (var i = 0; i < attachmentParts.length; i++) {
    var part = attachmentParts[i];
    if (part.body && part.body.attachmentId) {
      var file = downloadAndStoreAttachment(
        http,
        headers,
        files,
        params.messageId,
        part.body.attachmentId,
        part.filename || 'attachment',
        part.mimeType || 'application/octet-stream',
        part.body.size || 0,
      );
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
function checkDelivery(http, headers, params) {
  if (!params.internetMessageId) {
    throw new Error('internetMessageId is required.');
  }

  var isRfc2822 = params.internetMessageId.indexOf('<') !== -1;
  var delivered = false;

  if (isRfc2822) {
    var searchUrl =
      API_BASE +
      '/messages?q=rfc822msgid:' +
      encodeURIComponent(params.internetMessageId) +
      '&maxResults=1';
    var searchResponse = http.get(searchUrl, { headers: headers });
    handleError(searchResponse, 'check delivery');
    var searchData = searchResponse.json();
    delivered = !!(searchData.messages && searchData.messages.length > 0);
  } else {
    var msgUrl =
      API_BASE +
      '/messages/' +
      encodeURIComponent(params.internetMessageId) +
      '?format=minimal';
    var msgResponse = http.get(msgUrl, { headers: headers });
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
