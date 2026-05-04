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

const FOLDER_MIME = 'application/vnd.google-apps.folder';
// Soft caps for recursive listing. Hitting either returns a truncated result
// with `truncated: true` rather than throwing, so a sync workflow can still
// make progress on huge folders.
const RECURSIVE_FILE_CAP = 5000;
const RECURSIVE_DEPTH_CAP = 20;

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
  includeFolders: boolean,
): string {
  const parts: string[] = [];
  parts.push("'" + escapeDriveQueryLiteral(folderId) + "' in parents");
  parts.push('trashed = false');

  if (!includeFolders) {
    parts.push("mimeType != 'application/vnd.google-apps.folder'");
  }

  // mimeTypes filter applies only to files, not folders. When recursing we
  // need to enumerate folders unconditionally to descend into them, so the
  // mimeTypes filter is intentionally skipped in that mode and applied
  // client-side by the caller.
  if (mimeTypes && mimeTypes.length > 0 && !includeFolders) {
    const ors: string[] = [];
    for (let i = 0; i < mimeTypes.length; i++) {
      ors.push("mimeType = '" + escapeDriveQueryLiteral(mimeTypes[i]) + "'");
    }
    parts.push('(' + ors.join(' or ') + ')');
  }

  return parts.join(' and ');
}

// Replace characters that are valid in Drive folder names but rejected by
// Tale's folder name validator (which forbids '/' and '\') or that would
// otherwise corrupt the workflow's '/'-joined folderPath template. The
// substitution is one-way and lossy by design — `a?b` and `a_b` collide,
// which is acceptable at demo stage and avoidable by users renaming.
function sanitizeDriveFolderName(name: string): string {
  return name.replace(/[/\\?*<>:"|]/g, '_').slice(0, 255);
}

interface DriveRawFile {
  id: string;
  name: string;
  size?: string;
  mimeType?: string;
  modifiedTime?: string;
  md5Checksum?: string;
}

interface DrivePage {
  files?: DriveRawFile[];
  nextPageToken?: string;
}

interface OutputFile {
  id: string;
  name: string;
  size: number;
  mimeType: string | undefined;
  modifiedTime: string | undefined;
  md5Checksum: string | undefined;
  subfolderPath: string;
}

// Fetch every page for one folder query (no recursion). Drive's pageSize is
// capped at 200, so callers must paginate to get a complete list — leaving
// pagination to the workflow layer (as the original implementation did) is
// unsafe because reconcile_deletes uses the file list to compute deletes.
function listOnePageFolder(
  http: HttpApi,
  headers: Record<string, string>,
  folderId: string,
  mimeTypes: string[] | undefined,
  includeFolders: boolean,
): DriveRawFile[] {
  const q = buildListQuery(folderId, mimeTypes, includeFolders);
  const fields =
    'nextPageToken, files(id, name, size, mimeType, modifiedTime, md5Checksum)';

  const allFiles: DriveRawFile[] = [];
  let pageToken: string | undefined;

  while (true) {
    const queryParts = [
      'q=' + encodeURIComponent(q),
      'fields=' + encodeURIComponent(fields),
      'pageSize=200',
    ];
    if (pageToken) {
      queryParts.push('pageToken=' + encodeURIComponent(pageToken));
    }

    const url = API_BASE + '/files?' + queryParts.join('&');
    const response = http.get(url, { headers: headers });
    handleError(response, 'list files');

    const data = response.json() as DrivePage;
    const pageFiles = data.files || [];
    for (let i = 0; i < pageFiles.length; i++) {
      allFiles.push(pageFiles[i]);
    }

    if (!data.nextPageToken) {
      break;
    }
    pageToken = data.nextPageToken;
  }

  return allFiles;
}

function toOutputFile(raw: DriveRawFile, subfolderPath: string): OutputFile {
  return {
    id: raw.id,
    name: raw.name,
    size: raw.size ? parseInt(raw.size, 10) : 0,
    mimeType: raw.mimeType,
    modifiedTime: raw.modifiedTime,
    md5Checksum: raw.md5Checksum,
    subfolderPath: subfolderPath,
  };
}

function matchesMimeFilter(
  raw: DriveRawFile,
  mimeTypes: string[] | undefined,
): boolean {
  if (!mimeTypes || mimeTypes.length === 0) return true;
  if (!raw.mimeType) return false;
  for (let i = 0; i < mimeTypes.length; i++) {
    if (raw.mimeType === mimeTypes[i]) return true;
  }
  return false;
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
  const recursive = params.recursive === true;

  const files: OutputFile[] = [];
  let truncated = false;

  if (!recursive) {
    // Flat: one folder, exhaust pagination.
    const raw = listOnePageFolder(http, headers, folderId, mimeTypes, false);
    for (let i = 0; i < raw.length; i++) {
      if (files.length >= RECURSIVE_FILE_CAP) {
        truncated = true;
        break;
      }
      files.push(toOutputFile(raw[i], ''));
    }
  } else {
    // BFS over subfolders. One Drive query per folder returns files + folders
    // mixed (no `mimeType != folder` filter); we partition client-side.
    const queue: Array<{
      folderId: string;
      subfolderPath: string;
      depth: number;
    }> = [{ folderId: folderId, subfolderPath: '', depth: 0 }];

    outer: while (queue.length > 0) {
      const head = queue.shift() as {
        folderId: string;
        subfolderPath: string;
        depth: number;
      };

      const raw = listOnePageFolder(
        http,
        headers,
        head.folderId,
        undefined,
        true,
      );

      for (let i = 0; i < raw.length; i++) {
        const r = raw[i];
        if (r.mimeType === FOLDER_MIME) {
          if (head.depth + 1 > RECURSIVE_DEPTH_CAP) {
            truncated = true;
            continue;
          }
          const segment = sanitizeDriveFolderName(r.name);
          const childPath = head.subfolderPath
            ? head.subfolderPath + '/' + segment
            : segment;
          queue.push({
            folderId: r.id,
            subfolderPath: childPath,
            depth: head.depth + 1,
          });
        } else {
          if (!matchesMimeFilter(r, mimeTypes)) continue;
          if (files.length >= RECURSIVE_FILE_CAP) {
            truncated = true;
            break outer;
          }
          files.push(toOutputFile(r, head.subfolderPath));
        }
      }
    }
  }

  console.log(
    'Listed Drive files: count=' +
      files.length +
      ', recursive=' +
      recursive +
      ', truncated=' +
      truncated,
  );

  return {
    success: true,
    operation: 'list_files',
    data: {
      files: files,
      truncated: truncated,
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
