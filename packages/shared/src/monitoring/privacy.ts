/** The operational event fields that can contain request credentials. */
export interface PrivacyEvent {
  request?: {
    cookies?: unknown;
    data?: unknown;
    headers?: Record<string, string>;
    url?: string;
    query_string?: unknown;
  };
  transaction?: string;
  extra?: Record<string, unknown>;
  breadcrumbs?: Array<{ data?: Record<string, unknown> }>;
}

const FILTERED = '[Filtered]';

/** Header names whose value is a credential. */
const CREDENTIAL_HEADER =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$|token|secret|session|password/i;

/** Query parameters whose value is a credential or a one-time grant. */
const CREDENTIAL_QUERY =
  /^(code|state|token|access_token|id_token|refresh_token|key|api_key|secret|password|signature|sig)$/i;

/** A path segment after one of these is a credential: the automation
 * webhook trigger's token and a shared thread's token. */
const CREDENTIAL_PATH =
  /(\/automations\/webhook\/|\/threads\/shared\/)[^/?#]+/g;

/** Mask the credentials a URL can carry in its path and query. */
export function scrubUrl(url: string): string {
  const queryAt = url.indexOf('?');
  const head = queryAt === -1 ? url : url.slice(0, queryAt);
  const path = head.replace(CREDENTIAL_PATH, `$1${FILTERED}`);
  if (queryAt === -1) return path;
  const rest = url.slice(queryAt + 1);
  const fragmentAt = rest.indexOf('#');
  const search = fragmentAt === -1 ? rest : rest.slice(0, fragmentAt);
  const fragment = fragmentAt === -1 ? '' : rest.slice(fragmentAt);
  const params = search
    .split('&')
    .map((pair) => {
      const name = pair.split('=', 1)[0] ?? '';
      return CREDENTIAL_QUERY.test(name) ? `${name}=${FILTERED}` : pair;
    })
    .join('&');
  return `${path}?${params}${fragment}`;
}

/**
 * Drop cookies and bodies, and mask credential headers, path segments and
 * query values, on the event's request, its transaction name, the path this
 * module records and its breadcrumbs. Mutates and returns the event it was
 * given.
 */
export function scrubEvent<T extends PrivacyEvent>(event: T): T {
  const request = event.request;
  if (request !== undefined) {
    delete request.cookies;
    delete request.data;
    if (request.headers !== undefined) {
      for (const name of Object.keys(request.headers)) {
        if (CREDENTIAL_HEADER.test(name)) request.headers[name] = FILTERED;
      }
    }
    if (typeof request.url === 'string') request.url = scrubUrl(request.url);
    if (typeof request.query_string === 'string') {
      request.query_string = scrubUrl(`?${request.query_string}`).slice(1);
    } else if (request.query_string !== undefined) {
      delete request.query_string;
    }
  }
  // The server integration names the transaction after the raw path.
  if (typeof event.transaction === 'string') {
    event.transaction = scrubUrl(event.transaction);
  }
  if (typeof event.extra?.path === 'string') {
    event.extra.path = scrubUrl(event.extra.path);
  }
  for (const breadcrumb of event.breadcrumbs ?? []) {
    const data = breadcrumb.data;
    if (data !== undefined && typeof data.url === 'string') {
      data.url = scrubUrl(data.url);
    }
  }
  return event;
}
