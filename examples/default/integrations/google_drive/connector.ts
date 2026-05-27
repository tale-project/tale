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

const API_BASE = 'https://www.googleapis.com/drive/v3';

const connector = {
  operations: ['list_files', 'download_file'],

  testConnection: function (ctx: TestConnectionContext) {
    const accessToken = ctx.secrets.get('accessToken');
    if (!accessToken) {
      throw new Error(
        'Google access token is required. Please authorize via OAuth2.',
      );
    }

    const response = ctx.http.get(
      API_BASE + '/about?fields=user(emailAddress)',
      {
        headers: {
          Authorization: 'Bearer ' + accessToken,
          Accept: 'application/json',
        },
      },
    );

    if (response.status === 401) {
      throw new Error(
        'Authentication failed. Re-authorize the Google Drive integration.',
      );
    }
    if (response.status === 403) {
      throw new Error(
        'Access denied. Verify the OAuth client has the drive.readonly scope.',
      );
    }
    if (response.status !== 200) {
      throw new Error(
        'Drive API connection failed (' +
          response.status +
          '): ' +
          response.text(),
      );
    }

    const about = response.json() as { user?: { emailAddress?: string } };
    return {
      status: 'ok',
      emailAddress: about.user ? about.user.emailAddress : undefined,
    };
  },

  execute: function (ctx: ConnectorContext) {
    const operation = ctx.operation;
    const params = ctx.params;
    const accessToken = ctx.secrets.get('accessToken');
    if (!accessToken) {
      throw new Error('Google access token is required.');
    }

    const headers = {
      Authorization: 'Bearer ' + accessToken,
      Accept: 'application/json',
    };

    if (operation === 'list_files') {
      return listFiles(ctx.http, headers, params);
    }
    if (operation === 'download_file') {
      return downloadFile(ctx.http, ctx.files, headers, params);
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
        '. Verify the drive.readonly scope is granted.',
    );
  }
  if (response.status === 404) {
    throw new Error(
      'Resource not found during ' +
        operation +
        '. The folder or file may have been deleted or the OAuth account may not have access.',
    );
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
    } catch (_e) {
      errorBody = response.text();
    }
    throw new Error(
      'Google Drive API error during ' +
        operation +
        ' (' +
        response.status +
        '): ' +
        errorBody,
    );
  }
}

function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildListQuery(
  folderId: string,
  mimeTypes: string[] | undefined,
): string {
  const parts: string[] = [];
  parts.push("'" + escapeDriveQueryLiteral(folderId) + "' in parents");
  parts.push('trashed = false');

  // Always exclude folders themselves from the file list — we're syncing files,
  // not nested folder containers. (For now; subfolder recursion is a future op.)
  parts.push("mimeType != 'application/vnd.google-apps.folder'");

  if (mimeTypes && mimeTypes.length > 0) {
    const ors: string[] = [];
    for (let i = 0; i < mimeTypes.length; i++) {
      ors.push("mimeType = '" + escapeDriveQueryLiteral(mimeTypes[i]) + "'");
    }
    parts.push('(' + ors.join(' or ') + ')');
  }

  return parts.join(' and ');
}

function listFiles(
  http: HttpApi,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const folderId = params.folderId as string | undefined;
  if (!folderId) {
    throw new Error('folderId is required.');
  }

  const mimeTypes = Array.isArray(params.mimeTypes)
    ? (params.mimeTypes as string[])
    : undefined;

  const q = buildListQuery(folderId, mimeTypes);
  const fields =
    'nextPageToken, files(id, name, size, mimeType, modifiedTime, md5Checksum)';

  const queryParts = [
    'q=' + encodeURIComponent(q),
    'fields=' + encodeURIComponent(fields),
    'pageSize=200',
  ];
  if (params.pageToken) {
    queryParts.push(
      'pageToken=' + encodeURIComponent(params.pageToken as string),
    );
  }

  const url = API_BASE + '/files?' + queryParts.join('&');
  console.log('Listing Drive files: ' + url);

  const response = http.get(url, { headers: headers });
  handleError(response, 'list files');

  const data = response.json() as {
    files?: Array<{
      id: string;
      name: string;
      size?: string;
      mimeType?: string;
      modifiedTime?: string;
      md5Checksum?: string;
    }>;
    nextPageToken?: string;
  };

  const rawFiles = data.files || [];
  const files = rawFiles.map(function (f) {
    return {
      id: f.id,
      name: f.name,
      size: f.size ? parseInt(f.size, 10) : 0,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      md5Checksum: f.md5Checksum,
    };
  });

  return {
    success: true,
    operation: 'list_files',
    data: {
      files: files,
      pagination: {
        hasNextPage: !!data.nextPageToken,
        nextPageToken: data.nextPageToken || null,
      },
    },
    count: files.length,
    timestamp: Date.now(),
  };
}

function downloadFile(
  http: HttpApi,
  files: FilesApi | undefined,
  headers: Record<string, string>,
  params: Record<string, unknown>,
) {
  const fileId = params.fileId as string | undefined;
  const fileName = params.fileName as string | undefined;
  if (!fileId) {
    throw new Error('fileId is required.');
  }
  if (!fileName) {
    throw new Error('fileName is required.');
  }
  if (!files) {
    throw new Error(
      'File storage is not available. The ctx.files API is required for downloads.',
    );
  }

  // Drive returns the binary stream when alt=media is set. We let the sandbox's
  // download API do the streaming + storage in one round-trip.
  const url = API_BASE + '/files/' + encodeURIComponent(fileId) + '?alt=media';
  console.log('Downloading Drive file: ' + url);

  const stored = files.download(url, {
    headers: headers,
    fileName: fileName,
  });

  return {
    success: true,
    operation: 'download_file',
    data: {
      fileId: stored.fileId,
      fileName: stored.fileName,
      contentType:
        stored.contentType ||
        (params.contentType as string) ||
        'application/octet-stream',
      size: stored.size,
      url: stored.url,
    },
    count: 1,
    timestamp: Date.now(),
  };
}
