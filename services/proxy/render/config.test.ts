import { describe, expect, it } from 'bun:test';

import {
  BACKEND_LANES as LABELLED_BACKEND_LANES,
  PLATFORM_MACHINE_DOORS,
  backendApiLabels,
  platformLabels,
} from '../../../tools/cli/src/lib/compose/services/traefik-labels';
import {
  BACKEND_LANES,
  ConfigError,
  MACHINE_DOORS,
  leafHosts,
  readSettings,
  renderAcmeHosts,
  renderEdge,
  renderResponder,
  renderStatic,
  renderTls,
} from './config.js';

const base = {
  SITE_URL: 'https://tale.example.com',
  TALE_PROXY_PROJECTS: 'tale',
};
const paths = {
  run: '/run/tale-proxy',
  dynamic: '/run/tale-proxy/dynamic',
  data: '/data',
  share: '/usr/share/tale-proxy',
};

function refusal(env: Record<string, string>): string[] {
  try {
    readSettings(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).lines;
  }
  throw new Error('readSettings accepted the environment');
}

/** A Traefik PathRegexp (Go RE2) as a JavaScript RegExp: only `(?i)` differs. */
const goRegExp = (pattern: string) =>
  pattern.startsWith('(?i)')
    ? new RegExp(pattern.slice(4), 'i')
    : new RegExp(pattern);
const regexpOf = (rule: string) =>
  goRegExp(/PathRegexp\(`([^`]+)`\)/.exec(rule)?.[1] ?? '');

describe('readSettings', () => {
  it('keeps the entrypoint messages for a missing or plain-HTTP origin', () => {
    expect(refusal({ TALE_PROXY_PROJECTS: 'tale' })).toEqual([
      'Error: SITE_URL is required. Set it in your .env file.',
    ]);
    expect(refusal({ ...base, SITE_URL: 'http://tale.example.com' })).toEqual([
      'Error: SITE_URL must use https://. Plain HTTP is not supported.',
      '  If running behind a TLS-terminating reverse proxy, set TLS_MODE=external.',
    ]);
    expect(
      refusal({ ...base, ADDITIONAL_SITE_URLS: 'tale.example.org' }),
    ).toEqual([
      "Error: ADDITIONAL_SITE_URLS entry 'tale.example.org' must start with http:// or https://.",
    ]);
    expect(
      refusal({ ...base, ADDITIONAL_SITE_URLS: 'http://tale.example.org' })[0],
    ).toBe(
      "Error: ADDITIONAL_SITE_URLS entry 'http://tale.example.org' must use https://. Plain HTTP is not supported.",
    );
    expect(refusal({ ...base, DOCS_URL: 'http://docs.example.com' })[0]).toBe(
      'Error: DOCS_URL must use https://. Plain HTTP is not supported.',
    );
  });

  it('serves plain HTTP behind an external terminator', () => {
    const s = readSettings({
      ...base,
      SITE_URL: 'http://tale.example.com',
      TLS_MODE: 'external',
    });
    expect(s.mode).toBe('external');
    expect(s.https).toBe(false);
    expect(s.trustedProxies).toContain('10.0.0.0/8');
  });

  it('reads the additional origins as the entrypoint did', () => {
    const s = readSettings({
      ...base,
      SITE_URL: 'https://Tale.Example.com/',
      ADDITIONAL_SITE_URLS:
        'https://tale.example.org/, https://tale.example.org  https://[2001:db8::1]:8443',
    });
    expect(s.addresses).toEqual([
      'https://Tale.Example.com',
      'https://tale.example.org',
      'https://[2001:db8::1]:8443',
    ]);
    expect(s.hostnames).toEqual([
      'tale.example.com',
      'tale.example.org',
      '2001:db8::1',
    ]);
    expect(s.docsUrl).toBe('https://docs.localhost');
    expect(leafHosts(s)).toEqual([
      'tale.example.com',
      'tale.example.org',
      '2001:db8::1',
      'docs.localhost',
    ]);
  });

  it('refuses a host that could leave a rule', () => {
    expect(
      refusal({ ...base, SITE_URL: 'https://tale`) || Host(`evil' })[0],
    ).toContain('SITE_URL');
    expect(
      refusal({ ...base, ADDITIONAL_SITE_URLS: 'https://a b' }),
    ).toHaveLength(1);
  });

  it('normalises BASE_PATH and refuses one that is no path', () => {
    expect(readSettings({ ...base, BASE_PATH: 'app/' }).basePath).toBe('/app');
    expect(readSettings({ ...base, BASE_PATH: '/' }).basePath).toBe('');
    expect(refusal({ ...base, BASE_PATH: '/a b' })[0]).toContain('BASE_PATH');
    expect(refusal({ ...base, BASE_PATH: '/a`b' })[0]).toContain('BASE_PATH');
  });

  it('checks TRUSTED_PROXIES in external mode and notes it is ignored otherwise', () => {
    expect(
      refusal({
        ...base,
        TLS_MODE: 'external',
        TRUSTED_PROXIES: '10.0.0.0/8 nonsense',
      }),
    ).toEqual([
      "Error: TRUSTED_PROXIES entry 'nonsense' must be a CIDR range (e.g. 10.0.0.0/8) or private_ranges.",
      '  List the address ranges your TLS-terminating proxy connects from, separated by spaces.',
    ]);
    const external = readSettings({
      ...base,
      TLS_MODE: 'external',
      TRUSTED_PROXIES: '203.0.113.0/24 2001:db8::/32',
    });
    expect(external.trustedProxies).toEqual([
      '203.0.113.0/24',
      '2001:db8::/32',
    ]);
    const selfsigned = readSettings({ ...base, TRUSTED_PROXIES: '10.0.0.0/8' });
    expect(selfsigned.trustedProxies).toBeNull();
    expect(selfsigned.notes).toEqual([
      '  TRUSTED_PROXIES ignored: TLS_MODE=selfsigned terminates TLS in this proxy.',
    ]);
  });

  it('treats an unknown TLS_MODE as self-signed', () => {
    expect(readSettings({ ...base, TLS_MODE: 'acme' }).mode).toBe('selfsigned');
  });

  it('refuses a metrics token that could leave its rule, and bad project names', () => {
    expect(refusal({ ...base, METRICS_BEARER_TOKEN: 'a`b' })[0]).toContain(
      'METRICS_BEARER_TOKEN',
    );
    expect(refusal({ ...base, TALE_PROXY_PROJECTS: '' })[0]).toContain(
      'TALE_PROXY_PROJECTS',
    );
    expect(
      refusal({ ...base, TALE_PROXY_PROJECTS: 'tale) || (x' })[0],
    ).toContain('TALE_PROXY_PROJECTS');
  });
});

describe('renderStatic', () => {
  it('discovers only labelled containers of its own projects, through the API proxy', () => {
    const config = renderStatic(
      readSettings({ ...base, TALE_PROXY_PROJECTS: 'tale-blue, tale-green' }),
      paths,
    );
    expect(config.providers.docker).toEqual({
      endpoint: 'tcp://docker-api:2375',
      exposedByDefault: false,
      constraints:
        'LabelRegex(`com.docker.compose.project`, `^(tale-blue|tale-green)$`)',
    });
    expect(config.providers.file).toEqual({
      directory: '/run/tale-proxy/dynamic',
      watch: true,
    });
    expect(config).not.toHaveProperty('api');
    expect(config.ping).toEqual({ entryPoint: 'health', manualRouting: true });
  });

  it('terminates TLS on 443 and redirects 80, in self-signed mode', () => {
    const { entryPoints } = renderStatic(readSettings(base), paths);
    expect(entryPoints.web.http.redirections.entryPoint).toEqual({
      to: 'websecure',
      scheme: 'https',
      permanent: true,
    });
    expect(entryPoints.websecure.address).toBe(':443');
    expect(entryPoints.websecure.asDefault).toBe(true);
    expect(entryPoints.websecure.http.tls).toEqual({});
    expect(entryPoints.websecure.http.middlewares).toEqual(['tale-edge@file']);
    expect(entryPoints.websecure.http.sanitizePath).toBe(false);
    expect(entryPoints.websecure.http.maxHeaderBytes).toBe(65536);
    expect(entryPoints.websecure.transport.respondingTimeouts.readTimeout).toBe(
      0,
    );
    expect(entryPoints.health.address).toBe(':2020');
    expect(entryPoints).not.toHaveProperty('inner');
  });

  it("asks Let's Encrypt for every site host, over HTTP-01", () => {
    const s = readSettings({
      ...base,
      TLS_MODE: 'letsencrypt',
      ADDITIONAL_SITE_URLS: 'https://tale.example.org',
    });
    const config = renderStatic(s, paths);
    expect(config.entryPoints.websecure.http.tls).toEqual({
      certResolver: 'letsencrypt',
      domains: [{ main: 'tale.example.com' }, { main: 'tale.example.org' }],
    });
    expect(config.certificatesResolvers.letsencrypt.acme).toEqual({
      email: 'tls@localhost',
      storage: '/data/acme.json',
      httpChallenge: { entryPoint: 'web' },
    });
    expect(renderAcmeHosts(s)).toBe('tale.example.com\ntale.example.org\n');
  });

  it('serves HTTP on 80 behind an external terminator, trusting its headers only', () => {
    const config = renderStatic(
      readSettings({
        ...base,
        TLS_MODE: 'external',
        TRUSTED_PROXIES: '10.1.0.0/16',
      }),
      paths,
    );
    expect(config.entryPoints.web.asDefault).toBe(true);
    expect(config.entryPoints.web.forwardedHeaders).toEqual({
      trustedIPs: ['10.1.0.0/16'],
    });
    expect(config.entryPoints).not.toHaveProperty('websecure');
    expect(config).not.toHaveProperty('certificatesResolvers');
  });

  it('adds the loopback entrypoint a subpath request re-enters on', () => {
    const { entryPoints } = renderStatic(
      readSettings({ ...base, BASE_PATH: '/app' }),
      paths,
    );
    expect(entryPoints.inner.address).toBe('127.0.0.1:8098');
    expect(entryPoints.inner.forwardedHeaders).toEqual({
      trustedIPs: ['127.0.0.1/32'],
      notAppendXForwardedFor: true,
    });
  });
});

describe('renderEdge', () => {
  const routers = (env: Record<string, string> = {}) =>
    renderEdge(readSettings({ ...base, ...env })).http.routers;

  it('answers 404 for a host no origin names', () => {
    const rule = routers({ ADDITIONAL_SITE_URLS: 'https://tale.example.org' })[
      'tale-unknown-host'
    ].rule;
    expect(rule).toBe(
      '!(Host(`tale.example.com`) || Host(`tale.example.org`) || Host(`docs.localhost`))',
    );
  });

  it('refuses dot segments, plain or encoded, before any route', () => {
    const all = routers();
    const dots = regexpOf(all['tale-dot-segments'].rule);
    for (const path of [
      '/..',
      '/a/../b',
      '/%2e%2E/x',
      '/.%2e',
      '/dav/./x',
      '/api/v1/..',
    ]) {
      expect({ path, refused: dots.test(path) }).toEqual({
        path,
        refused: true,
      });
    }
    for (const path of [
      '/',
      '/a.b/c',
      '/.well-known/openid-configuration',
      '/x...y',
      '/assets/app.js',
    ]) {
      expect({ path, refused: dots.test(path) }).toEqual({
        path,
        refused: false,
      });
    }
    expect(all['tale-dot-segments-api'].priority).toBeGreaterThan(
      all['tale-dot-segments'].priority,
    );
    expect(all['tale-dot-segments-api'].middlewares).toEqual([
      'tale-answer-not-found-json',
    ]);
    expect(all['tale-dot-segments-dav'].middlewares).toEqual([
      'tale-answer-not-found-dav',
    ]);
  });

  it('keeps /api/control closed and /metrics behind the bearer token', () => {
    const closed = routers();
    expect(closed['tale-control'].rule).toBe(
      'Path(`/api/control`) || PathPrefix(`/api/control/`)',
    );
    expect(
      regexpOf(closed['tale-metrics-unauthorized'].rule).test(
        '/METRICS/backend',
      ),
    ).toBe(true);
    expect(
      Object.keys(closed).filter((name) => name.startsWith('tale-metrics-')),
    ).toEqual(['tale-metrics-unauthorized']);

    const open = routers({ METRICS_BEARER_TOKEN: 's3cret' });
    expect(open['tale-metrics-backend'].rule).toBe(
      'Path(`/metrics/backend`) && Header(`Authorization`, `Bearer s3cret`)',
    );
    expect(open['tale-metrics-backend'].priority).toBeGreaterThan(
      open['tale-metrics-unauthorized'].priority,
    );
    expect(open['tale-metrics-platform'].middlewares).toEqual([
      'tale-metrics-path',
    ]);
    expect(open['tale-metrics-sla-rules'].service).toBe('tale-platform');
  });

  it('answers a machine door with JSON and a person with the page when nothing serves them', () => {
    const all = routers();
    const doors = regexpOf(all['tale-absent-machine-door'].rule);
    for (const path of [
      '/api/v1/x',
      '/api',
      '/scim/v2/Users',
      '/http_api/x',
      '/events',
      '/status.json',
      '/openapi.json',
      '/.well-known/x',
    ]) {
      expect({ path, door: doors.test(path) }).toEqual({ path, door: true });
    }
    for (const path of ['/', '/dashboard', '/apiary', '/eventsx']) {
      expect({ path, door: doors.test(path) }).toEqual({ path, door: false });
    }
    expect(all['tale-absent'].priority).toBeLessThan(
      all['tale-absent-machine-door'].priority,
    );
  });

  it('answers every backend lane with JSON while the backend is absent', () => {
    // The labels and the edge carry one rule each; they must stay one rule.
    expect(BACKEND_LANES).toBe(LABELLED_BACKEND_LANES);
    expect(MACHINE_DOORS).toBe(PLATFORM_MACHINE_DOORS);
    const absent = routers()['tale-absent-backend'];
    expect(absent.middlewares).toEqual(['tale-answer-unavailable-json']);
    const lanes = regexpOf(absent.rule);
    for (const path of [
      '/api/v1/me',
      '/API/auth/session',
      '/events',
      '/dav/files/a.txt',
      '/scim/v2/Users',
      '/http_api/api/sso/callback',
      '/http_api/scim/v2/Users',
      '/.well-known/oauth-authorization-server/api/auth',
      '/.well-known/oauth-protected-resource',
    ]) {
      expect({ path, lane: lanes.test(path) }).toEqual({ path, lane: true });
    }
    for (const path of [
      '/api',
      '/eventsx',
      '/scim/x',
      '/http_api/x',
      '/.well-known/openid-configuration',
      '/status.json',
      '/davx',
    ]) {
      expect({ path, lane: lanes.test(path) }).toEqual({ path, lane: false });
    }
    // Below the backend's own lanes, above the platform's machine doors.
    const priority = (labels: Record<string, string>, router: string) =>
      Number(labels[`traefik.http.routers.${router}.priority`]);
    expect(
      priority(backendApiLabels('blue'), 'backend-api-blue'),
    ).toBeGreaterThan(absent.priority);
    expect(absent.priority).toBeGreaterThan(
      priority(platformLabels('blue'), 'platform-blue-doors'),
    );
  });

  it('strips BASE_PATH and routes the rest on the inner entrypoint', () => {
    const edge = renderEdge(readSettings({ ...base, BASE_PATH: '/a.b' }));
    const router = edge.http.routers['tale-base-path'];
    expect(router.rule).toBe('PathRegexp(`^/a\\.b(/|$)`)');
    expect(regexpOf(router.rule).test('/a.b/api/x')).toBe(true);
    expect(regexpOf(router.rule).test('/aXb/api/x')).toBe(false);
    expect(regexpOf(router.rule).test('/a.bc')).toBe(false);
    expect(edge.http.middlewares['tale-base-path']).toEqual({
      stripPrefix: { prefixes: ['/a.b'] },
    });
    expect(edge.http.routers['tale-control'].entryPoints).toEqual([
      'websecure',
      'inner',
    ]);
  });

  it('strips what must not reach a service, and the product disclosure', () => {
    const { headers } = renderEdge(readSettings(base)).http.middlewares[
      'tale-edge'
    ];
    expect(headers.customRequestHeaders).toEqual({
      Expect: '',
      'Sec-WebSocket-Extensions': '',
      'X-Analytics-Client-IP': '',
    });
    expect(headers.customResponseHeaders).toEqual({ Server: '', Via: '' });
  });
});

describe('renderTls', () => {
  it('serves the issued leaf as the default certificate', () => {
    const leaf = { cert: 'CERT', key: 'KEY' };
    expect(
      renderTls(readSettings(base), leaf).tls.stores.default.defaultCertificate,
    ).toEqual({ certFile: 'CERT', keyFile: 'KEY' });
    const acme = renderTls(
      readSettings({ ...base, TLS_MODE: 'letsencrypt' }),
      null,
    );
    expect(acme.tls.stores.default.defaultGeneratedCert).toEqual({
      resolver: 'letsencrypt',
      domain: { main: 'tale.example.com' },
    });
    expect(
      renderTls(readSettings({ ...base, TLS_MODE: 'external' }), null),
    ).toEqual({});
  });
});

describe('renderResponder', () => {
  it('writes the JSON refusals with the platform headers, HSTS only under https', () => {
    const https = renderResponder(readSettings(base), paths);
    expect(https).toContain('"code":"UPSTREAM_UNAVAILABLE"');
    expect(https).toContain(`'{"error":"Not found","code":"NOT_FOUND"}'`);
    expect(https).toContain('Strict-Transport-Security "max-age=31536000"');
    expect(https).toContain('add_header Retry-After 5 always;');
    const http = renderResponder(
      readSettings({
        ...base,
        SITE_URL: 'http://tale.example.com',
        TLS_MODE: 'external',
      }),
      paths,
    );
    expect(http).not.toContain('Strict-Transport-Security');
  });
});
