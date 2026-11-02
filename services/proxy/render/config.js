// The edge's configuration, rendered at boot from the environment the proxy
// has always read: SITE_URL with its additional origins, DOCS_URL, BASE_PATH,
// TLS_MODE, TLS_EMAIL, TRUSTED_PROXIES and METRICS_BEARER_TOKEN, plus the
// Compose projects whose container labels this edge serves.
//
// Plain ES module without imports: the image runs it with njs (QuickJS, see
// main.js), the tests import it with Bun. Every output is JSON, which
// Traefik reads as YAML.
//
// Routing is split in two. A service declares its own routes in container
// labels (tools/cli/src/lib/compose/services/traefik-labels.ts and
// compose.yml); this file renders what belongs to the edge itself and holds
// for every service: which hosts are served, the subpath, the refusals that
// run before any route, the metrics gate whose token never leaves this
// environment, and the answers when a service is absent or failing.

/** The edge's own answers: a loopback nginx (renderResponder). */
export const RESPONDER = '127.0.0.1:8099';
/** The entrypoint a subpath request re-enters with its prefix stripped. */
export const INNER = '127.0.0.1:8098';
/** The read-only Docker API proxy (services/proxy/docker-api/nginx.conf). */
export const DOCKER_API = 'tcp://docker-api:2375';

// What `private_ranges` names, and what an empty TRUSTED_PROXIES trusts:
// the private and loopback ranges.
const PRIVATE_RANGES = [
  '192.168.0.0/16',
  '172.16.0.0/12',
  '10.0.0.0/8',
  '127.0.0.1/8',
  'fd00::/8',
  '::1',
];

const IPV4_OCTET = '(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])';
const IPV4_CIDR = new RegExp(
  `^(${IPV4_OCTET}\\.){3}${IPV4_OCTET}/(3[0-2]|[12]?[0-9])$`,
);
const IPV6_CIDR =
  /^[0-9A-Fa-f]{0,4}(:[0-9A-Fa-f]{0,4}){2,7}\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
// A hostname, or an IP literal. Hosts land inside Traefik rules, so nothing
// that could close a rule's backtick string gets through.
const HOSTNAME =
  /^([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)*[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.?$/;
const IPV6_LITERAL = /^\[[0-9A-Fa-f:.]+\]$/;
const URL_PARTS =
  /^(https?):\/\/([^/:?#[\]]+|\[[^\]]*\])(:[0-9]+)?(\/[^?#]*)?$/i;
// A URL path of one or more segments, from RFC 3986's pchar.
const BASE_PATH = /^(\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)+$/;
// A Compose project name (compose-spec: lowercase letters, digits, dashes,
// underscores, starting with a letter or digit).
const PROJECT = /^[a-z0-9][a-z0-9_-]*$/;

const HINT_EXTERNAL =
  '  If running behind a TLS-terminating reverse proxy, set TLS_MODE=external.';

/** A refusal to start: every line goes to stderr, and the proxy exits 1. */
export class ConfigError extends Error {
  constructor(lines) {
    super(lines.join('\n'));
    this.lines = lines;
  }
}

const trim = (value) => value.replace(/^\s+|\s+$/g, '');
const stripTrailingSlashes = (value) => value.replace(/\/+$/, '');
const words = (value) => trim(value).split(/\s+/).filter(Boolean);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The hostname of an origin, as a Traefik `Host()` rule compares it. */
function hostnameOf(name, url) {
  const parts = URL_PARTS.exec(url);
  if (!parts) {
    throw new ConfigError([
      `Error: ${name} '${url}' must be an origin such as https://tale.example.com.`,
    ]);
  }
  const host = parts[2].toLowerCase();
  if (IPV6_LITERAL.test(host)) return host.slice(1, -1);
  if (!HOSTNAME.test(host)) {
    throw new ConfigError([
      `Error: ${name} '${url}' has a host that is not a valid hostname.`,
    ]);
  }
  return host.replace(/\.$/, '');
}

function trustedProxies(env) {
  const ranges = [];
  for (const range of words(env.TRUSTED_PROXIES || 'private_ranges')) {
    if (
      range !== 'private_ranges' &&
      !IPV4_CIDR.test(range) &&
      !IPV6_CIDR.test(range)
    ) {
      throw new ConfigError([
        `Error: TRUSTED_PROXIES entry '${range}' must be a CIDR range (e.g. 10.0.0.0/8) or private_ranges.`,
        '  List the address ranges your TLS-terminating proxy connects from, separated by spaces.',
      ]);
    }
    for (const entry of range === 'private_ranges' ? PRIVATE_RANGES : [range]) {
      if (!ranges.includes(entry)) ranges.push(entry);
    }
  }
  return ranges.length > 0 ? ranges : PRIVATE_RANGES.slice();
}

/**
 * Reads and validates the environment: normalises the origins, the subpath
 * and the TLS settings, and throws a ConfigError on what the edge cannot
 * serve.
 */
export function readSettings(env) {
  const host = env.HOST || 'localhost';
  const mode =
    env.TLS_MODE === 'external' || env.TLS_MODE === 'letsencrypt'
      ? env.TLS_MODE
      : 'selfsigned';
  const notes = [];

  const siteUrl = stripTrailingSlashes(trim(env.SITE_URL || ''));
  if (siteUrl === '') {
    throw new ConfigError([
      'Error: SITE_URL is required. Set it in your .env file.',
    ]);
  }

  let basePath = stripTrailingSlashes(trim(env.BASE_PATH || ''));
  if (basePath !== '' && !basePath.startsWith('/')) basePath = `/${basePath}`;
  if (basePath !== '' && !BASE_PATH.test(basePath)) {
    throw new ConfigError([
      `Error: BASE_PATH '${basePath}' must be a URL path such as /tale.`,
    ]);
  }

  const addresses = [siteUrl];
  for (const raw of words(
    (env.ADDITIONAL_SITE_URLS || '').replace(/,/g, ' '),
  )) {
    const extra = stripTrailingSlashes(raw);
    if (extra === '') continue;
    if (!extra.startsWith('http://') && !extra.startsWith('https://')) {
      throw new ConfigError([
        `Error: ADDITIONAL_SITE_URLS entry '${extra}' must start with http:// or https://.`,
      ]);
    }
    if (!addresses.includes(extra)) addresses.push(extra);
  }

  let docsUrl = trim(stripTrailingSlashes(trim(env.DOCS_URL || '')));
  if (docsUrl === '') docsUrl = `https://docs.${host}`;

  if (mode !== 'external') {
    if (/^http:\/\//i.test(siteUrl)) {
      throw new ConfigError([
        'Error: SITE_URL must use https://. Plain HTTP is not supported.',
        HINT_EXTERNAL,
      ]);
    }
    for (const address of addresses) {
      if (/^http:\/\//i.test(address)) {
        throw new ConfigError([
          `Error: ADDITIONAL_SITE_URLS entry '${address}' must use https://. Plain HTTP is not supported.`,
          HINT_EXTERNAL,
        ]);
      }
    }
    if (/^http:\/\//i.test(docsUrl)) {
      throw new ConfigError([
        'Error: DOCS_URL must use https://. Plain HTTP is not supported.',
        HINT_EXTERNAL,
      ]);
    }
  }

  const hostnames = [];
  for (const address of addresses) {
    const name =
      address === siteUrl ? 'SITE_URL' : 'ADDITIONAL_SITE_URLS entry';
    const hostname = hostnameOf(name, address);
    if (!hostnames.includes(hostname)) hostnames.push(hostname);
  }
  const docsHostname = hostnameOf('DOCS_URL', docsUrl);

  let trusted = null;
  if (mode === 'external') {
    trusted = trustedProxies(env);
  } else if (trim(env.TRUSTED_PROXIES || '') !== '') {
    notes.push(
      `  TRUSTED_PROXIES ignored: TLS_MODE=${env.TLS_MODE || 'selfsigned'} terminates TLS in this proxy.`,
    );
  }

  const metricsToken = env.METRICS_BEARER_TOKEN || '';
  if (/[`\r\n]/.test(metricsToken)) {
    throw new ConfigError([
      'Error: METRICS_BEARER_TOKEN must not contain a backtick or a line break.',
    ]);
  }

  const projects = words((env.TALE_PROXY_PROJECTS || '').replace(/,/g, ' '));
  if (projects.length === 0) {
    throw new ConfigError([
      'Error: TALE_PROXY_PROJECTS is required: the Compose projects whose services this proxy routes.',
    ]);
  }
  for (const project of projects) {
    if (!PROJECT.test(project)) {
      throw new ConfigError([
        `Error: TALE_PROXY_PROJECTS entry '${project}' is not a Compose project name.`,
      ]);
    }
  }

  return {
    host,
    mode,
    siteUrl,
    addresses,
    hostnames,
    docsUrl,
    docsHostname,
    basePath,
    email: env.TLS_EMAIL || `tls@${host}`,
    emailIsDefault: !env.TLS_EMAIL,
    trustedProxies: trusted,
    metricsToken,
    projects,
    https: /^https:\/\//i.test(siteUrl),
    notes,
  };
}

/** What the proxy prints at boot. */
export function describe(s) {
  const lines = [
    'Domain Configuration:',
    `  HOST: ${s.host}`,
    `  SITE_URL: ${s.siteUrl}`,
  ];
  if (s.addresses.length > 1) {
    lines.push(`  ADDITIONAL_SITE_URLS: ${s.addresses.slice(1).join(' ')}`);
  }
  lines.push(`  DOCS_URL: ${s.docsUrl}`);
  if (s.basePath) lines.push(`  BASE_PATH: ${s.basePath}`);
  lines.push('TLS Configuration:', `  TLS_MODE: ${s.mode}`);
  if (s.mode === 'external') {
    lines.push(
      '  Mode: External (TLS handled by reverse proxy, this proxy serves HTTP only)',
      `  Trusted proxies: ${s.trustedProxies.join(' ')}`,
    );
  } else if (s.mode === 'letsencrypt') {
    lines.push(
      "  Mode: Let's Encrypt (ACME - trusted certificates)",
      s.emailIsDefault
        ? `  Email: ${s.email} (default, set TLS_EMAIL to override)`
        : `  Email: ${s.email}`,
    );
  } else {
    lines.push(
      '  Mode: Self-signed (internal CA - browser warning expected)',
      '  For client trust, copy /data/pki/root.crt from this container and install it in the client OS/browser trust store.',
      '  See https://tale.dev/docs/self-hosted/configuration/tls-and-domains',
    );
  }
  lines.push(...s.notes);
  lines.push(
    `Routing: labelled services of the Compose projects ${s.projects.join(', ')}`,
    `Metrics: ${s.metricsToken ? 'enabled (bearer token set)' : 'disabled (METRICS_BEARER_TOKEN unset)'}`,
  );
  return lines;
}

/** The entrypoint public requests arrive on. */
const publicEntryPoint = (s) => (s.mode === 'external' ? 'web' : 'websecure');

/** Every entrypoint the routes are matched on. */
function routingEntryPoints(s) {
  return s.basePath ? [publicEntryPoint(s), 'inner'] : [publicEntryPoint(s)];
}

/** Traefik's static configuration (traefik.yml). */
export function renderStatic(s, paths) {
  const transport = { respondingTimeouts: { readTimeout: 0 } };
  const routing = {
    // Labelled routers name no entrypoint and land on these. The edge's
    // refusals see the path as sent: Traefik must not clean it first.
    asDefault: true,
    http: {
      middlewares: ['tale-edge@file'],
      sanitizePath: false,
      maxHeaderBytes: 65536,
      encodedCharacters: {
        allowEncodedSlash: true,
        allowEncodedBackSlash: true,
        allowEncodedNullCharacter: true,
        allowEncodedSemicolon: true,
        allowEncodedPercent: true,
        allowEncodedQuestionMark: true,
        allowEncodedHash: true,
      },
    },
    transport,
  };

  const entryPoints = {
    health: { address: ':2020' },
  };
  if (s.mode === 'external') {
    entryPoints.web = {
      address: ':80',
      ...routing,
      forwardedHeaders: { trustedIPs: s.trustedProxies },
    };
  } else {
    entryPoints.web = {
      address: ':80',
      http: {
        redirections: {
          entryPoint: { to: 'websecure', scheme: 'https', permanent: true },
        },
      },
    };
    const tls =
      s.mode === 'letsencrypt'
        ? {
            certResolver: 'letsencrypt',
            domains: s.hostnames.map((main) => ({ main })),
          }
        : {};
    entryPoints.websecure = {
      address: ':443',
      ...routing,
      http: { ...routing.http, tls },
    };
  }
  if (s.basePath) {
    // The subpath router (renderEdge) strips the prefix and sends the
    // request back in here, so the labelled routes match the bare path.
    entryPoints.inner = {
      address: INNER,
      asDefault: true,
      http: {
        sanitizePath: false,
        encodedCharacters: routing.http.encodedCharacters,
      },
      forwardedHeaders: {
        trustedIPs: ['127.0.0.1/32'],
        notAppendXForwardedFor: true,
      },
      transport,
    };
  }

  const config = {
    global: { checkNewVersion: false, sendAnonymousUsage: false },
    log: { level: 'INFO' },
    accessLog: {},
    ping: { entryPoint: 'health', manualRouting: true },
    entryPoints,
    providers: {
      docker: {
        endpoint: DOCKER_API,
        exposedByDefault: false,
        constraints: `LabelRegex(\`com.docker.compose.project\`, \`^(${s.projects.join('|')})$\`)`,
      },
      file: { directory: paths.dynamic, watch: true },
    },
  };
  if (s.mode === 'letsencrypt') {
    config.certificatesResolvers = {
      letsencrypt: {
        acme: {
          email: s.email,
          storage: `${paths.data}/acme.json`,
          httpChallenge: { entryPoint: 'web' },
        },
      },
    };
  }
  return config;
}

// The machine doors: lanes a program calls, which get a JSON answer rather
// than the maintenance page. Judged on the path alone. The platform's labels
// carry the same rule (tools/cli/src/lib/compose/services/traefik-labels.ts).
export const MACHINE_DOORS =
  '(?i)^/((api|scim|http_api)(/|$)|(events|status[.]json|openapi[.]json)$|[.]well-known/)';
// Every path the backend serves, as its labels declare it; answered here while
// the backend is absent, above the platform's machine doors, so a program
// calling the backend never reaches the platform instead.
export const BACKEND_LANES =
  '(?i)^/(api/|events$|dav/|scim/v2/|http_api/(api/sso|scim/v2|api/trusted-headers|api/cloud-import/oauth2)/|[.]well-known/oauth-(authorization-server/|protected-resource))';
// The platform's health probe, as its labels declare it; answered here while
// the platform is absent, above the backend's lanes, whose `/api/` would
// answer it in the platform's place.
export const PLATFORM_HEALTH = '(?i)^/api/health$';
// A dot-segment, plain or percent-encoded, anywhere in the path. No honest
// client sends one; refused before any route, so a path never means one
// thing to the router and another to the service that folds the dots.
const DOT_SEGMENT = '(?i)(^|/)(%2e|[.]){1,2}(/|$)';

/** One of the responder's answers (renderResponder), as a router's target. */
function answer(name) {
  return { middlewares: [`tale-answer-${name}`], service: 'tale-responder' };
}

/** Traefik's dynamic configuration for the edge's own routes (edge.yml). */
export function renderEdge(s) {
  const all = routingEntryPoints(s);
  const main = [publicEntryPoint(s)];
  const hostRule = s.hostnames
    .concat([s.docsHostname])
    .map((name) => `Host(\`${name}\`)`)
    .join(' || ');

  const routers = {
    // A host none of the origins names gets nothing from any service.
    'tale-unknown-host': {
      entryPoints: main,
      rule: `!(${hostRule})`,
      priority: 1000,
      ...answer('not-found'),
    },
    'tale-docs-health': {
      entryPoints: main,
      rule: `Host(\`${s.docsHostname}\`) && Path(\`/health\`)`,
      priority: 960,
      service: 'ping@internal',
    },
    // The docs site (services/docs). Only the dev chain runs it; elsewhere
    // the name does not resolve and the docs host answers 502.
    'tale-docs': {
      entryPoints: main,
      rule: `Host(\`${s.docsHostname}\`)`,
      priority: 950,
      middlewares: ['tale-compress'],
      service: 'tale-docs',
    },
    'tale-dot-segments-api': {
      entryPoints: all,
      rule: `PathRegexp(\`${DOT_SEGMENT}\`) && PathRegexp(\`(?i)(^|/)api(/|$)\`)`,
      priority: 920,
      ...answer('not-found-json'),
    },
    'tale-dot-segments-dav': {
      entryPoints: all,
      rule: `PathRegexp(\`${DOT_SEGMENT}\`) && PathRegexp(\`(?i)(^|/)dav(/|$)\`)`,
      priority: 910,
      ...answer('not-found-dav'),
    },
    'tale-dot-segments': {
      entryPoints: all,
      rule: `PathRegexp(\`${DOT_SEGMENT}\`)`,
      priority: 900,
      ...answer('not-found'),
    },
    // The control plane is never public, whichever service owns /api.
    'tale-control': {
      entryPoints: all,
      rule: 'Path(`/api/control`) || PathPrefix(`/api/control/`)',
      priority: 800,
      ...answer('not-found'),
    },
    // Every /metrics path answers 401 unless the gate below lets it through,
    // so scrapers (e.g. Grafana Cloud) know auth is required.
    'tale-metrics-unauthorized': {
      entryPoints: all,
      rule: 'PathRegexp(`(?i)^/metrics(/.*)?$`)',
      priority: 700,
      ...answer('unauthorized'),
    },
    'tale-health': {
      entryPoints: all,
      rule: 'Path(`/health`)',
      priority: 600,
      service: 'ping@internal',
    },
    'tale-health-port': {
      entryPoints: ['health'],
      rule: 'Path(`/health`)',
      service: 'ping@internal',
    },
    // Nothing serves the path: the service is absent, starting or stopped.
    // Its own routes come back with its container.
    'tale-absent-platform-health': {
      entryPoints: all,
      rule: `PathRegexp(\`${PLATFORM_HEALTH}\`)`,
      priority: 150,
      ...answer('unavailable-json'),
    },
    'tale-absent-backend': {
      entryPoints: all,
      rule: `PathRegexp(\`${BACKEND_LANES}\`)`,
      priority: 90,
      ...answer('unavailable-json'),
    },
    'tale-absent-machine-door': {
      entryPoints: all,
      rule: `PathRegexp(\`${MACHINE_DOORS}\`)`,
      priority: 3,
      ...answer('unavailable-json'),
    },
    'tale-absent': {
      entryPoints: all,
      rule: 'PathPrefix(`/`)',
      priority: 1,
      ...answer('unavailable-page'),
    },
  };
  if (s.metricsToken) {
    const bearer = `Header(\`Authorization\`, \`Bearer ${s.metricsToken}\`)`;
    Object.assign(routers, {
      'tale-metrics-platform': {
        entryPoints: all,
        rule: `Path(\`/metrics/platform\`) && ${bearer}`,
        priority: 750,
        middlewares: ['tale-metrics-path'],
        service: 'tale-platform',
      },
      'tale-metrics-sla-rules': {
        entryPoints: all,
        rule: `Path(\`/metrics/sla-rules\`) && ${bearer}`,
        priority: 750,
        service: 'tale-platform',
      },
      'tale-metrics-backend': {
        entryPoints: all,
        rule: `Path(\`/metrics/backend\`) && ${bearer}`,
        priority: 750,
        middlewares: ['tale-metrics-path'],
        service: 'tale-backend',
      },
    });
  }
  if (s.basePath) {
    // A subpath deployment: the prefix is stripped and the request re-enters
    // on the inner entrypoint, where every route matches the bare path. A
    // path without the prefix is routed as it is.
    routers['tale-base-path'] = {
      entryPoints: main,
      rule: `PathRegexp(\`^${escapeRegExp(s.basePath)}(/|$)\`)`,
      priority: 500,
      middlewares: ['tale-base-path'],
      service: 'tale-inner',
    };
  }

  const answers = {
    'not-found': '/_tale/not-found',
    'not-found-json': '/_tale/not-found-json',
    'not-found-dav': '/_tale/not-found-dav',
    unauthorized: '/_tale/unauthorized',
    'unavailable-json': '/_tale/absent-json',
    'unavailable-page': '/_tale/absent-page',
  };
  const middlewares = {
    // Every public request and answer: the request loses what must not
    // reach a service, the answer loses the product disclosure.
    'tale-edge': {
      headers: {
        customRequestHeaders: {
          // The edge answers `Expect: 100-continue` itself; forwarded too,
          // the origin wrote a second `100 Continue`.
          Expect: '',
          // permessage-deflate negotiation broke WebSocket frames.
          'Sec-WebSocket-Extensions': '',
          // The analytics provenance header is never the browser's to set.
          'X-Analytics-Client-IP': '',
        },
        customResponseHeaders: { Server: '', Via: '' },
      },
    },
    'tale-compress': {
      compress: {
        encodings: ['zstd', 'gzip'],
        // An event stream is written as it happens; a compressor would
        // hold events back until its buffer fills.
        excludedContentTypes: ['text/event-stream'],
      },
    },
    // A failing service (502–504), by the kind of door: the page for a
    // person, JSON for a program. Its own 500s and the rest pass through.
    'tale-unavailable-page': {
      errors: {
        status: ['502-504'],
        service: 'tale-responder',
        query: '/_tale/unavailable-page',
      },
    },
    'tale-unavailable-json': {
      errors: {
        status: ['502-504'],
        service: 'tale-responder',
        query: '/_tale/unavailable-json',
      },
    },
    'tale-metrics-path': { replacePath: { path: '/metrics' } },
  };
  for (const [name, path] of Object.entries(answers)) {
    middlewares[`tale-answer-${name}`] = { replacePath: { path } };
  }
  if (s.basePath) {
    middlewares['tale-base-path'] = {
      stripPrefix: { prefixes: [s.basePath] },
    };
  }

  const server = (url) => ({ loadBalancer: { servers: [{ url }] } });
  const services = {
    'tale-responder': server(`http://${RESPONDER}`),
    'tale-docs': server('http://docs:3002'),
    'tale-platform': server('http://platform:3000'),
    'tale-backend': server('http://backend-api:3005'),
  };
  if (s.basePath) services['tale-inner'] = server(`http://${INNER}`);

  return { http: { routers, middlewares, services } };
}

/**
 * The certificates (tls.yml): the issued leaf in self-signed mode, inline so
 * that a reissued leaf changes the file Traefik watches; in Let's Encrypt
 * mode the ACME certificate of SITE_URL's host, as the default for a client
 * that sends no server name.
 */
export function renderTls(s, leaf) {
  if (s.mode === 'letsencrypt') {
    return {
      tls: {
        stores: {
          default: {
            defaultGeneratedCert: {
              resolver: 'letsencrypt',
              domain: { main: s.hostnames[0] },
            },
          },
        },
      },
    };
  }
  if (s.mode === 'selfsigned') {
    const certificate = { certFile: leaf.cert, keyFile: leaf.key };
    return {
      tls: {
        certificates: [certificate],
        stores: { default: { defaultCertificate: certificate } },
      },
    };
  }
  return {};
}

/** The hosts the self-signed leaf names: every site host and the docs host. */
export function leafHosts(s) {
  return s.hostnames.includes(s.docsHostname)
    ? s.hostnames.slice()
    : s.hostnames.concat([s.docsHostname]);
}

/**
 * The responder: a loopback nginx that writes the edge's own answers — the
 * refusals, the maintenance page and the JSON for a door whose service is
 * absent or failing. A failing service's answer keeps its status (Traefik's
 * errors middleware); an absent one answers 503.
 */
export function renderResponder(s, paths) {
  const hsts = s.https
    ? '\n      add_header Strict-Transport-Security "max-age=31536000" always;'
    : '';
  // The JSON refusals carry the headers the platform's own errors do, and a
  // request id to quote.
  const json = `default_type application/json;
      add_header X-Request-Id $tale_request_id always;
      add_header Cache-Control no-store always;
      add_header X-Content-Type-Options nosniff always;
      add_header X-Frame-Options DENY always;
      add_header Referrer-Policy strict-origin-when-cross-origin always;${hsts}`;
  const unavailable = `'{"error":"The platform is not answering right now — a deployment may be rolling; retry with backoff","code":"UPSTREAM_UNAVAILABLE","requestId":"$tale_request_id"}'`;
  return `# Rendered by services/proxy/render at boot; edit the renderer, not this file.
worker_processes 1;
pid ${paths.run}/responder.pid;
error_log stderr warn;
events { worker_connections 1024; }
http {
  access_log off;
  server_tokens off;
  charset utf-8;
  client_body_temp_path ${paths.run}/responder-body;
  proxy_temp_path ${paths.run}/responder-proxy;
  fastcgi_temp_path ${paths.run}/responder-fastcgi;
  uwsgi_temp_path ${paths.run}/responder-uwsgi;
  scgi_temp_path ${paths.run}/responder-scgi;
  # nginx's request id, in the UUID shape the platform's ids have.
  map $request_id $tale_request_id {
    "~^(?<a>[0-9a-f]{8})(?<b>[0-9a-f]{4})(?<c>[0-9a-f]{4})(?<d>[0-9a-f]{4})(?<e>[0-9a-f]{12})$" "$a-$b-$c-$d-$e";
  }
  server {
    listen ${RESPONDER};
    default_type text/plain;
    root ${paths.share};
    error_page 503 /_tale/maintenance;
    location = /_tale/not-found {
      return 404 "Not found";
    }
    location = /_tale/not-found-json {
      ${json}
      return 404 '{"error":"Not found","code":"NOT_FOUND"}';
    }
    location = /_tale/not-found-dav {
      add_header Cache-Control no-store always;
      return 404 "Not found";
    }
    location = /_tale/unauthorized {
      add_header WWW-Authenticate Bearer always;
      return 401 "Unauthorized";
    }
    location = /_tale/absent-json {
      ${json}
      add_header Retry-After 5 always;
      return 503 ${unavailable};
    }
    location = /_tale/unavailable-json {
      ${json}
      add_header Retry-After 5 always;
      return 200 ${unavailable};
    }
    location = /_tale/absent-page {
      return 503;
    }
    location = /_tale/unavailable-page {
      add_header Cache-Control no-store always;
      try_files /maintenance.html =404;
    }
    location = /_tale/maintenance {
      internal;
      add_header Cache-Control no-store always;
      try_files /maintenance.html =404;
    }
    location / {
      return 404 "Not found";
    }
  }
}
`;
}

/** The hosts the ACME retry (tale-proxy) waits for, one per line. */
export function renderAcmeHosts(s) {
  return s.mode === 'letsencrypt' ? `${s.hostnames.join('\n')}\n` : '';
}
