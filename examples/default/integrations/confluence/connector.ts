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

interface HttpApi {
  get(url: string, options?: HttpMethodOptions): HttpResponse;
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

// One Confluence search page returns up to 100 results. Each in-connector
// `http.get` consumes one sandbox pass (MAX_PASSES=50), so cursor pagination is
// bounded: cap at 40 requests (~4000 pages) and report `truncated` rather than
// risk exhausting the pass budget — which would surface as a silent empty
// result. Spaces larger than this need workflow-layer pagination (see plan).
const PAGE_LIMIT = 100;
const MAX_LIST_PAGES = 40;

// Below this many characters of extracted text we treat `export_view` as having
// rendered to a husk (a page that is mostly dynamic/Connect macros — Jira issue
// tables, draw.io, aggregating excerpts — which the REST renderer leaves empty)
// and fall back to the raw storage format so the page indexes *something*.
const NEAR_EMPTY_TEXT = 16;

interface ConfluenceAuth {
  apiBase: string;
  origin: string;
  headers: Record<string, string>;
}

// Confluence "Connect" credentials are an account email + API token sent as
// HTTP Basic. The site is supplied per-install as `domain`; normalize it down
// to the bare tenant label so the request URL is always well-formed and a
// malformed value fails with a clear setup error instead of `new URL` throwing
// or — worse — building a request against the wrong host.
function buildAuth(
  ctx: ConnectorContext | TestConnectionContext,
): ConfluenceAuth {
  const email = ctx.secrets.get('username');
  const token = ctx.secrets.get('password');
  if (!email || !token) {
    throw new Error(
      'Confluence requires an Atlassian account email (Username) and API token (Password).',
    );
  }

  const raw = String(ctx.secrets.get('domain') || '').trim();
  const site = raw
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\.atlassian\.net$/i, '')
    .toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(site)) {
    throw new Error(
      'Confluence site is not configured or is invalid. Enter just the <site> from ' +
        'https://<site>.atlassian.net (letters, digits, and hyphens only).',
    );
  }

  const origin = 'https://' + site + '.atlassian.net';
  return {
    apiBase: origin + '/wiki/rest/api',
    origin: origin,
    headers: {
      Authorization: 'Basic ' + ctx.base64Encode(email + ':' + token),
      Accept: 'application/json',
    },
  };
}

function handleError(response: HttpResponse, operation: string): void {
  if (response.status === 401) {
    throw new Error(
      'Authentication failed during ' +
        operation +
        ' (401). Check the Atlassian account email and API token (the token may have expired — they last at most one year).',
    );
  }
  if (response.status === 403) {
    throw new Error(
      'Permission denied during ' +
        operation +
        ' (403). The Atlassian account may not have access to this space or page.',
    );
  }
  if (response.status === 429) {
    throw new Error(
      'Rate limited by the Confluence API during ' +
        operation +
        ' (429). Try again later or stagger sync schedules.',
    );
  }
  if (response.status >= 400) {
    let detail = '';
    try {
      const err = response.json() as { message?: string };
      detail = err && err.message ? err.message : response.text();
    } catch (_e) {
      detail = response.text();
    }
    throw new Error(
      'Confluence API error during ' +
        operation +
        ' (' +
        response.status +
        '): ' +
        detail,
    );
  }
}

// CQL string literals are double-quoted; escape backslashes and quotes so a
// space key or label can never break out of the literal or alter the query.
function cqlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// CQL has no `status` field, and the content-search endpoint already defaults
// to current content (archived and trashed are excluded) — exactly what this
// additive sync wants. Adding `status=...` returns HTTP 400 ("No field exists
// with the name: 'status'").
function buildCql(spaceKey: string, label: string | undefined): string {
  let cql = 'space="' + cqlEscape(spaceKey) + '" and type=page';
  if (label) {
    cql += ' and label="' + cqlEscape(label) + '"';
  }
  return cql;
}

// Page titles can contain characters that are valid in Confluence but would
// corrupt the '/'-joined folderPath or trip Tale's folder-name validator.
// Strip ASCII control characters, substitute reserved path characters, and
// never emit an empty segment.
function sanitizeFolderName(name: string): string {
  let cleaned = String(name || '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[/\\?*<>:"|]/g, '_')
    .trim()
    .slice(0, 255);
  if (cleaned.length > 0) {
    const lastCode = cleaned.charCodeAt(cleaned.length - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdfff) {
      cleaned = cleaned.slice(0, -1);
    }
  }
  if (cleaned === '.' || cleaned === '..') {
    cleaned = '_';
  }
  return cleaned.length > 0 ? cleaned : '_';
}

// Convert Confluence's rendered HTML to plain text. RAG runs no HTML extraction
// (it decodes and chunks bytes verbatim), so storing markup would pollute
// embeddings with tags and CSS. This pass keeps prose readable: drop
// script/style outright, turn block boundaries into newlines, strip remaining
// tags, decode the entities Confluence emits, and collapse whitespace.
function htmlToText(html: string): string {
  if (!html) {
    return '';
  }
  let s = html;
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(
    /<\/(p|div|li|tr|h[1-6]|blockquote|section|article|header|footer|table|ul|ol|pre)\s*>/gi,
    '\n',
  );
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'");
  s = s.replace(/&#(\d+);/g, function (_m: string, dec: string) {
    return String.fromCharCode(parseInt(dec, 10));
  });
  // Ampersand last so a literal "&amp;lt;" doesn't double-decode into "<".
  s = s.replace(/&amp;/gi, '&');
  s = s.replace(/[ \t\f\v]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

interface ConfluencePageRef {
  id: string;
  type?: string;
  title: string;
  version?: { number?: number; when?: string };
  ancestors?: Array<{ id?: string; title?: string }>;
  space?: { key?: string };
  _links?: { webui?: string };
}

interface ConfluenceSearchPage {
  results?: ConfluencePageRef[];
  _links?: { base?: string; next?: string };
}

interface OutputPage {
  id: string;
  title: string;
  version: number;
  modifiedAt: string | undefined;
  spaceKey: string | undefined;
  ancestorPath: string;
  hasChildren: boolean;
  // Path under the space folder where this page's document lives. A container
  // page (one that has children) nests into a folder named after itself, so its
  // own content and its children share that folder — instead of the page doc
  // colliding with a same-named sibling folder.
  folderSubPath: string;
  webUrl: string | undefined;
}

function toOutputPage(
  r: ConfluencePageRef,
  base: string | undefined,
  parentIds: Record<string, boolean>,
): OutputPage {
  const ancestors = Array.isArray(r.ancestors) ? r.ancestors : [];
  const ancestorPath = ancestors
    .map((a) => sanitizeFolderName(a && a.title ? a.title : ''))
    .join('/');
  const hasChildren = !!(r.id && parentIds[r.id]);
  const selfSegment = sanitizeFolderName(r.title);
  const folderSubPath = hasChildren
    ? ancestorPath
      ? ancestorPath + '/' + selfSegment
      : selfSegment
    : ancestorPath;
  return {
    id: r.id,
    title: r.title,
    version: r.version && r.version.number ? r.version.number : 0,
    modifiedAt: r.version ? r.version.when : undefined,
    spaceKey: r.space ? r.space.key : undefined,
    ancestorPath: ancestorPath,
    hasChildren: hasChildren,
    folderSubPath: folderSubPath,
    webUrl:
      base && r._links && r._links.webui ? base + r._links.webui : undefined,
  };
}

function listPages(
  http: HttpApi,
  auth: ConfluenceAuth,
  params: Record<string, unknown>,
) {
  const spaceKey = params.spaceKey as string | undefined;
  if (!spaceKey) {
    throw new Error('spaceKey is required.');
  }
  const label =
    typeof params.label === 'string' && params.label ? params.label : undefined;

  const cql = buildCql(spaceKey, label);
  let url =
    auth.apiBase +
    '/content/search?cql=' +
    encodeURIComponent(cql) +
    '&expand=version,ancestors,space&limit=' +
    PAGE_LIMIT;

  // First pass: collect the raw refs (paginated). We can only decide which
  // pages are containers once the whole set is known, so map to OutputPage in a
  // second pass below.
  const rawPages: ConfluencePageRef[] = [];
  let base: string | undefined;
  let truncated = false;
  let fetched = 0;

  while (true) {
    const response = http.get(url, { headers: auth.headers });
    handleError(response, 'list pages');

    const data = response.json() as ConfluenceSearchPage;
    const results = Array.isArray(data.results) ? data.results : [];
    if (base === undefined && data._links) {
      base = data._links.base;
    }
    for (let i = 0; i < results.length; i++) {
      rawPages.push(results[i]);
    }
    fetched++;

    const next = data._links ? data._links.next : undefined;
    if (!next) {
      break;
    }
    if (fetched >= MAX_LIST_PAGES) {
      // Stop before the sandbox pass budget bites. The page set is incomplete,
      // so flag it: the workflow skips delete-style cleanup on a truncated list
      // (and v1 is additive-only regardless).
      truncated = true;
      break;
    }
    // `next` is relative to `_links.base` (e.g. "/rest/api/content/search?...")
    // and omits the "/wiki" prefix that base carries. Resolve against base
    // verbatim; do NOT prepend apiBase (doubles "/rest/api") or origin (drops
    // "/wiki").
    if (base) {
      url = base + next;
    } else {
      url = auth.origin + '/wiki' + next;
    }
  }

  // A page is a container (becomes a folder) iff it is an ancestor of another
  // page in the set.
  const parentIds: Record<string, boolean> = {};
  for (let i = 0; i < rawPages.length; i++) {
    const anc = rawPages[i].ancestors;
    if (Array.isArray(anc)) {
      for (let j = 0; j < anc.length; j++) {
        const a = anc[j];
        if (a && a.id) {
          parentIds[a.id] = true;
        }
      }
    }
  }

  const pages: OutputPage[] = [];
  for (let i = 0; i < rawPages.length; i++) {
    pages.push(toOutputPage(rawPages[i], base, parentIds));
  }

  console.log(
    'Listed Confluence pages: count=' +
      pages.length +
      ', requests=' +
      fetched +
      ', truncated=' +
      truncated,
  );

  return {
    success: true,
    operation: 'list_pages',
    data: {
      pages: pages,
      truncated: truncated,
    },
    count: pages.length,
    timestamp: Date.now(),
  };
}

function getPage(
  http: HttpApi,
  files: FilesApi | undefined,
  auth: ConfluenceAuth,
  params: Record<string, unknown>,
) {
  const pageId = params.pageId as string | undefined;
  const title = params.title as string | undefined;
  if (!pageId) {
    throw new Error('pageId is required.');
  }
  if (!title) {
    throw new Error('title is required.');
  }
  if (!files) {
    throw new Error(
      'File storage is not available. The ctx.files API is required to store page content.',
    );
  }

  const url =
    auth.apiBase +
    '/content/' +
    encodeURIComponent(pageId) +
    '?expand=body.export_view,body.storage';
  const response = http.get(url, { headers: auth.headers });

  // A page listed in one run can be deleted, archived, or restricted before we
  // fetch it. Treat those as skip-with-warning: throw a clear message so the
  // loop's continueOnError moves to the next page instead of aborting the batch
  // or creating an empty document.
  if (response.status === 404 || response.status === 410) {
    throw new Error(
      'Confluence page ' +
        pageId +
        ' no longer exists (deleted between listing and fetch) — skipping.',
    );
  }
  if (response.status === 403) {
    throw new Error(
      'Confluence page ' +
        pageId +
        ' is restricted for this account — skipping.',
    );
  }
  handleError(response, 'get page');

  const body = response.json() as {
    body?: {
      export_view?: { value?: string };
      storage?: { value?: string };
    };
  };
  const exportHtml =
    body.body && body.body.export_view ? body.body.export_view.value || '' : '';
  let text = htmlToText(exportHtml);
  if (text.length < NEAR_EMPTY_TEXT) {
    const storageHtml =
      body.body && body.body.storage ? body.body.storage.value || '' : '';
    const fallback = htmlToText(storageHtml);
    if (fallback.length > text.length) {
      text = fallback;
    }
  }

  const stored = files.store(text, {
    encoding: 'utf-8',
    contentType: 'text/plain',
    fileName: title + '.txt',
  });

  return {
    success: true,
    operation: 'get_page',
    data: {
      fileId: stored.fileId,
      fileName: stored.fileName,
      contentType: stored.contentType,
      size: stored.size,
      url: stored.url,
    },
    count: 1,
    timestamp: Date.now(),
  };
}

const connector = {
  operations: ['list_pages', 'get_page'],

  testConnection: function (ctx: TestConnectionContext) {
    const auth = buildAuth(ctx);
    const response = ctx.http.get(auth.apiBase + '/space?limit=1', {
      headers: auth.headers,
    });

    if (response.status === 401) {
      throw new Error(
        'Authentication failed. Check the Atlassian account email and API token.',
      );
    }
    if (response.status === 403) {
      throw new Error(
        'Access denied. Verify the Atlassian account has access to Confluence on this site.',
      );
    }
    if (response.status !== 200) {
      throw new Error(
        'Confluence connection failed (' +
          response.status +
          '): ' +
          response.text(),
      );
    }

    return { status: 'ok' };
  },

  execute: function (ctx: ConnectorContext) {
    const auth = buildAuth(ctx);

    if (ctx.operation === 'list_pages') {
      return listPages(ctx.http, auth, ctx.params);
    }
    if (ctx.operation === 'get_page') {
      return getPage(ctx.http, ctx.files, auth, ctx.params);
    }

    throw new Error('Unknown operation: ' + ctx.operation);
  },
};
