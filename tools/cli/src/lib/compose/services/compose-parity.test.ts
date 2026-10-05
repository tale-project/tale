import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

import { parse } from 'yaml';

import { setProjectId } from '../../project/project-context';
import { generateStatefulCompose } from '../generators/generate-stateful-compose';
import type { ComposeService, ServiceConfig } from '../types';
import {
  ALL_SERVICES,
  THIRD_PARTY_IMAGES,
  imagePlatform,
  imageRef,
  imageRepoForService,
  isValidService,
} from '../types';
import {
  createBackendApiService,
  createBackendWorkerService,
} from './create-backend-services';
import { createDbService } from './create-db-service';
import { createObjectStorageService } from './create-object-storage-service';
import {
  EGRESS_HEALTH_PROBE,
  createSandboxEgressService,
} from './create-sandbox-egress-service';
import { createSandboxService } from './create-sandbox-service';

// Guards the class of "works in dev, silently broken in `tale deploy`" bugs:
// config that lives in one pipeline but not the other. `compose.yml` (the
// `docker compose up` base) and the CLI generators (`tale deploy`) are two
// hand-maintained sources of truth; this asserts they agree on the load-bearing,
// safety-critical dimensions so drift fails CI instead of shipping.
//
// Documented past drifts this locks down: NET_ADMIN silently dropped (R1.17),
// uncapped egress proxy (R2-B11), and `stop_grace_period` missing from
// compose.yml (10s default → SIGKILL of in-flight HTTP/SSE + sandbox execs).

setProjectId('test-project');
const config = {
  version: '0.0.0-test',
  registry: 'ghcr.io/tale-project',
} satisfies ServiceConfig;

const composePath = fileURLToPath(
  new URL('../../../../../../compose.yml', import.meta.url),
);
const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url));
const compose = parse(readFileSync(composePath, 'utf8')) as {
  services: Record<
    string,
    {
      networks?: unknown;
      cap_add?: string[];
      cap_drop?: string[];
      sysctls?: Record<string, string>;
      stop_grace_period?: string;
      stop_signal?: string;
      image?: string;
      platform?: string;
      build?: unknown;
      ports?: unknown[];
      environment?: Record<string, string>;
      healthcheck?: { test?: string[] };
      pids_limit?: number;
      ulimits?: Record<string, number | { soft: number; hard: number }>;
    }
  >;
};

function networkNames(networks: unknown): string[] {
  if (Array.isArray(networks)) return networks as string[];
  if (networks && typeof networks === 'object') return Object.keys(networks);
  return [];
}

/** The shell command a generated service probes with, '' when it has none. */
function probeOf(service: ComposeService): string {
  const healthcheck = service.healthcheck;
  if (!healthcheck || 'disable' in healthcheck) return '';
  return healthcheck.test.join(' ');
}

/**
 * The `HEALTHCHECK` directive of a Dockerfile, continuation lines folded in —
 * the surrounding comments are NOT part of it, so a comment that names the
 * probe we moved away from can't satisfy (or break) an assertion.
 */
function dockerfileHealthcheck(source: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.startsWith('HEALTHCHECK'));
  if (start === -1) return '';
  const directive: string[] = [];
  for (const line of lines.slice(start)) {
    directive.push(line.trimEnd().replace(/\\$/, ''));
    if (!line.trimEnd().endsWith('\\')) break;
  }
  return directive.join(' ');
}

function graceSeconds(value: string | undefined): number {
  if (!value) return 0;
  const match = /^(\d+)s$/.exec(value);
  return match ? Number(match[1]) : 0;
}

function apiNetworks(colour?: 'blue'): Record<string, { aliases?: string[] }> {
  const networks = createBackendApiService(
    config,
    colour === undefined ? {} : { colour },
  ).networks;
  if (Array.isArray(networks) || networks === undefined) {
    throw new Error('api networks should be the object form with aliases');
  }
  return networks;
}

describe('sandbox→backend reachability parity', () => {
  test('CLI generator dual-homes the api onto the sandbox net with its alias', () => {
    const networks = apiNetworks();
    expect(networks.internal).toBeDefined();
    expect(networks.sandbox).toBeDefined();
    // The dev variant pins `<project>-backend-api`, so the explicit alias is
    // what makes http://backend-api:3005 resolve from a session container.
    expect(networks.sandbox?.aliases).toContain('backend-api');
  });

  // Production runs the COLOUR variant, which has no pinned name at all —
  // its replicas are `<project>-<colour>-backend-api-<n>`. Without the
  // explicit alias on BOTH networks, every in-sandbox host call and every
  // proxied `/api` lane would fail to resolve the moment the tier moved into
  // the colours.
  test('the colour variant keeps both aliases on both networks', () => {
    const networks = apiNetworks('blue');
    expect(networks.internal?.aliases).toContain('backend-api');
    expect(networks.sandbox?.aliases).toContain('backend-api');
    expect(networks.internal?.aliases).toContain('backend-api-blue');
  });

  // A colour is its own compose PROJECT, and compose has no cross-project
  // dependencies: a `depends_on` naming `db` would make the whole colour file
  // invalid. The dev variant, whose db IS in the same file, keeps its.
  test('the colour variant carries no depends_on, the dev variant does', () => {
    expect(
      createBackendApiService(config, { colour: 'blue' }).depends_on,
    ).toBeUndefined();
    expect(
      createBackendWorkerService(config, { colour: 'blue' }).depends_on,
    ).toBeUndefined();
    expect(createBackendApiService(config).depends_on).toBeDefined();
  });

  test('compose.yml keeps the api on the sandbox network', () => {
    // compose.yml's service is literally named `backend-api`, so service-name
    // resolution covers the alias — only membership must be asserted.
    expect(networkNames(compose.services['backend-api']?.networks)).toContain(
      'sandbox',
    );
  });
});

describe('sandbox device hub parity', () => {
  test('both pipelines turn the device hub on, overridable to 0', () => {
    const expected = '${SANDBOX_HUB_PORT:-8004}';
    expect(compose.services['sandbox']?.environment?.SANDBOX_HUB_PORT).toBe(
      expected,
    );
    expect(createSandboxService(config).environment?.SANDBOX_HUB_PORT).toBe(
      expected,
    );
  });

  test('the proxy publishes only the hub door, never the signed spawner API', () => {
    const caddyfile = readFileSync(
      resolve(repoRoot, 'services/proxy/Caddyfile'),
      'utf8',
    );
    expect(caddyfile).toContain('handle /sandbox/tunnel {');
    expect(caddyfile).toContain(
      'reverse_proxy {$SANDBOX_HUB_UPSTREAM:sandbox:8004}',
    );
    expect(caddyfile).not.toMatch(/reverse_proxy [^\n]*sandbox:8003/);
  });
});

describe('SSRF egress-firewall cap parity (NET_ADMIN — R1.17 guard)', () => {
  test('operator inner Docker pool reaches the spawner in both compose pipelines', () => {
    const expected = '${SANDBOX_DIND_INNER_POOL:-}';
    expect(
      compose.services['sandbox']?.environment?.SANDBOX_DIND_INNER_POOL,
    ).toBe(expected);
    expect(
      createSandboxService(config).environment?.SANDBOX_DIND_INNER_POOL,
    ).toBe(expected);
  });

  test('egress disables IPv6 for current and future interfaces in both compose pipelines', () => {
    const expected = {
      'net.ipv6.conf.all.disable_ipv6': '1',
      'net.ipv6.conf.default.disable_ipv6': '1',
    };
    expect(compose.services['sandbox-egress']?.sysctls).toEqual(expected);
    expect(createSandboxEgressService(config).sysctls).toEqual(expected);
  });

  test('CLI generator keeps NET_ADMIN on the backend tier', () => {
    expect(createBackendApiService(config).cap_add).toContain('NET_ADMIN');
    expect(createBackendWorkerService(config).cap_add).toContain('NET_ADMIN');
  });

  test('compose.yml keeps NET_ADMIN on the backend tier', () => {
    expect(compose.services['backend-api']?.cap_add).toContain('NET_ADMIN');
    expect(compose.services['backend-worker']?.cap_add).toContain('NET_ADMIN');
  });

  test('compose.yml keeps NET_ADMIN on the sandbox-egress proxy', () => {
    expect(compose.services['sandbox-egress']?.cap_add).toContain('NET_ADMIN');
  });

  test('egress uses the exact capability set in both compose pipelines', () => {
    const expected = [
      'CHOWN',
      'DAC_OVERRIDE',
      'KILL',
      'NET_ADMIN',
      'NET_BIND_SERVICE',
      'SETGID',
      'SETUID',
    ];
    for (const service of [
      compose.services['sandbox-egress'],
      createSandboxEgressService(config),
    ]) {
      expect(service?.cap_drop).toEqual(['ALL']);
      expect([...(service?.cap_add ?? [])].sort()).toEqual(expected);
    }
  });
});

describe('egress connection capacity parity', () => {
  const expected = '${SANDBOX_EGRESS_MAX_CLIENTS:-2000}';
  const egress = createSandboxEgressService(config);

  test('both pipelines hand the proxy the same connection limit', () => {
    expect(
      compose.services['sandbox-egress']?.environment
        ?.SANDBOX_EGRESS_MAX_CLIENTS,
    ).toBe(expected);
    expect(egress.environment?.SANDBOX_EGRESS_MAX_CLIENTS).toBe(expected);
  });

  test('both pipelines size the container for the default limit', () => {
    const connections = Number(/:-(\d+)\}$/.exec(expected)?.[1]);
    expect(connections).toBe(2000);
    expect(compose.services['sandbox-egress']?.pids_limit).toBe(
      egress.pids_limit,
    );
    expect(compose.services['sandbox-egress']?.ulimits).toEqual(egress.ulimits);
    // tinyproxy runs a thread and holds two descriptors (client and
    // upstream) per connection, beside its own few.
    expect(egress.pids_limit).toBeGreaterThan(connections + 64);
    const nofile = egress.ulimits?.nofile;
    expect(typeof nofile === 'object' ? nofile.soft : nofile).toBeGreaterThan(
      2 * connections + 64,
    );
  });
});

describe('egress readiness probe parity (log-flood guard)', () => {
  // tinyproxy logs EVERY connect-and-close at ERROR ("read_request_line:
  // Client (file descriptor: N) closed socket before read."), so a bare TCP
  // probe wrote one error line per interval, for the lifetime of the
  // container, into the log an operator reads to find real failures. It also
  // called a proxy that accepts but never answers healthy. The probe must be a real
  // HTTP request, in both pipelines AND in the image's own HEALTHCHECK (which
  // is what runs wherever neither compose file overrides it).
  const pipelines: [string, string][] = [
    [
      'compose.yml',
      (compose.services['sandbox-egress']?.healthcheck?.test ?? []).join(' '),
    ],
    ['CLI generator', probeOf(createSandboxEgressService(config))],
    [
      'image HEALTHCHECK',
      dockerfileHealthcheck(
        readFileSync(
          resolve(repoRoot, 'services/sandbox-egress/Dockerfile'),
          'utf8',
        ),
      ),
    ],
  ];

  for (const [pipeline, command] of pipelines) {
    test(`${pipeline} probes the proxy over HTTP, not a bare TCP connect`, () => {
      expect(command).toContain(EGRESS_HEALTH_PROBE);
      expect(command).not.toMatch(/nc\s+-z/);
    });
  }
});

describe('sandbox spawner URL parity', () => {
  // session_client.ts defaults to localhost:8003 (host bun-dev). A container
  // worker without SANDBOX_URL dies on every agent start with "fetch failed".
  // Both compose pipelines and the backend entrypoint must default it.
  test('both pipelines point the backend tier at the sandbox alias', () => {
    for (const tier of ['backend-api', 'backend-worker'] as const) {
      expect(compose.services[tier]?.environment?.SANDBOX_URL).toContain(
        'sandbox:8003',
      );
    }
    for (const service of [
      createBackendApiService(config),
      createBackendWorkerService(config),
    ]) {
      expect(service.environment?.SANDBOX_URL).toContain('sandbox:8003');
    }
  });

  test('agent profile and effort settings reach both backend roles through both compose pipelines', () => {
    for (const tier of ['backend-api', 'backend-worker'] as const) {
      expect(compose.services[tier]?.environment?.SANDBOX_AGENT_PROFILE).toBe(
        '${SANDBOX_AGENT_PROFILE:-agent}',
      );
      expect(
        compose.services[tier]?.environment?.TALE_SANDBOX_CLAUDE_EFFORT,
      ).toBe('${TALE_SANDBOX_CLAUDE_EFFORT:-}');
    }
    for (const service of [
      createBackendApiService(config),
      createBackendWorkerService(config),
    ]) {
      expect(service.environment?.SANDBOX_AGENT_PROFILE).toBe(
        '${SANDBOX_AGENT_PROFILE:-agent}',
      );
      expect(service.environment?.TALE_SANDBOX_CLAUDE_EFFORT).toBe(
        '${TALE_SANDBOX_CLAUDE_EFFORT:-}',
      );
    }
  });

  test('backend entrypoint defaults SANDBOX_URL so a worker without compose env still reaches the spawner', () => {
    const entrypoint = readFileSync(
      resolve(repoRoot, 'services/platform/docker-entrypoint.sh'),
      'utf8',
    );
    expect(entrypoint).toContain(
      'SANDBOX_URL="${SANDBOX_URL:-http://sandbox:8003}"',
    );
  });
});

describe('web-tier backend URL parity', () => {
  // status-probe.ts and server.ts default TALE_BACKEND_URL to the host-dev
  // loopback, which nothing serves inside the platform container. compose.yml
  // sets the alias explicitly; the CLI's colour compose relies on env.sh, so a
  // compose file that left the variable unset showed "Service outage" on a
  // healthy stack.
  test('compose.yml points the web tier at the backend alias', () => {
    expect(compose.services.platform?.environment?.TALE_BACKEND_URL).toContain(
      'backend-api:3005',
    );
  });

  test('web-tier env.sh defaults TALE_BACKEND_URL so a platform container without compose env still reaches the backend', () => {
    const envScript = readFileSync(
      resolve(repoRoot, 'services/platform/env.sh'),
      'utf8',
    );
    expect(envScript).toContain(
      'TALE_BACKEND_URL="${TALE_BACKEND_URL:-http://backend-api:3005}"',
    );
  });
});

describe('graceful-shutdown parity — compose.yml meets the floor', () => {
  // The CLI side is floor-tested in generate-color-compose.test.ts (>=41s). This
  // guards the OTHER pipeline: compose.yml must not regress to Docker's 10s
  // default, which SIGKILLs in-flight HTTP/SSE chat streams + sandbox execs on
  // `docker compose up`.
  test('platform drains streams before SIGKILL (mirrors CLI 45s)', () => {
    expect(
      graceSeconds(compose.services.platform?.stop_grace_period),
    ).toBeGreaterThanOrEqual(45);
  });

  test('sandbox spawner drains executions before SIGKILL (mirrors CLI 30s)', () => {
    expect(
      graceSeconds(compose.services.sandbox?.stop_grace_period),
    ).toBeGreaterThanOrEqual(30);
  });
});

describe('shared tale-db image is built once', () => {
  // `db` and `knowledge-db` are the same ParadeDB image in different roles.
  // Two `build:` blocks on one tag race `docker compose up --build` on the
  // containerd store ("image already exists") and leave `bun dev` without
  // Postgres. Only `db` builds; knowledge-db reuses the tag.
  test('knowledge-db reuses db image and does not declare its own build', () => {
    expect(compose.services['knowledge-db']?.image).toBe(
      compose.services.db?.image,
    );
    expect(compose.services.db?.build).toBeDefined();
    expect(compose.services['knowledge-db']?.build).toBeUndefined();
  });
});

describe('bgutil PO-token provider parity (zero-config YouTube ingestion)', () => {
  // The sidecar must exist in BOTH pipelines, on the same image tag, or one
  // path silently loses PO tokens (YouTube bot wall returns). The tag must also
  // match BGUTIL_POT_VERSION in services/platform/Dockerfile (checked there
  // via the pinned SHA256) — asserted here as a constant so a bump touches
  // both.
  const EXPECTED_IMAGE = 'brainicism/bgutil-ytdlp-pot-provider:1.3.1';

  test('compose.yml defines bgutil-provider on the pinned image', () => {
    expect(compose.services['bgutil-provider']?.image).toBe(EXPECTED_IMAGE);
  });

  test('compose.yml keeps bgutil-provider on the internal network', () => {
    expect(networkNames(compose.services['bgutil-provider']?.networks)).toEqual(
      ['internal'],
    );
  });

  test('CLI generator emits bgutil-provider on the same pinned image', () => {
    const generated = parse(
      generateStatefulCompose(config, 'tale.example'),
    ) as {
      services: Record<string, { image?: string; networks?: unknown }>;
    };
    expect(generated.services['bgutil-provider']?.image).toBe(EXPECTED_IMAGE);
    expect(
      networkNames(generated.services['bgutil-provider']?.networks),
    ).toEqual(['internal']);
  });

  // yt-dlp --plugin-dirs DIR does DIR.iterdir() then looks for yt_dlp_plugins
  // under each child. Unzipping the bgutil zip (which already contains
  // yt_dlp_plugins/) straight into DIR yields Plugin directories: none. The
  // Dockerfile must nest under /opt/yt-dlp/plugins/bgutil/.
  test('Dockerfile unzips the bgutil plugin under a named child of plugin-dirs', () => {
    const dockerfile = readFileSync(
      resolve(repoRoot, 'services/platform/Dockerfile'),
      'utf8',
    );
    expect(dockerfile).toContain(
      'unzip -q /tmp/bgutil-pot.zip -d /opt/yt-dlp/plugins/bgutil',
    );
    expect(dockerfile).not.toMatch(
      /unzip -q \/tmp\/bgutil-pot\.zip -d \/opt\/yt-dlp\/plugins\s/,
    );
  });
});

describe('blob-backend parity (the deployment cannot accept an upload without it)', () => {
  // S3-compatible storage is the ONLY blob backend — Convex `_storage` retired
  // with the runtime — and `backend/lib/object-store.ts` fails CLOSED when
  // neither the org nor the deployment default has a connection. So a pipeline
  // that omits the store ships a deployment where every upload 503s, which is
  // exactly the drift that shipped once already: the store was designed in
  // (inc 08 "compose ships MinIO + a seeded connection at cutover") and then
  // never added to either compose lane.

  test('compose.yml ships the object store', () => {
    expect(compose.services['object-store']).toBeDefined();
  });

  test('CLI generator ships the object store on the same image', () => {
    const pinned = compose.services['object-store']?.image;
    expect(pinned).toBeDefined();
    expect(createObjectStorageService(config).image).toBe(pinned as string);
  });

  test('the store stays internal — blobs reach the browser via presigned URLs', () => {
    expect(networkNames(compose.services['object-store']?.networks)).toEqual([
      'internal',
    ]);
    expect(compose.services['object-store']?.ports).toBeUndefined();
    expect(networkNames(createObjectStorageService(config).networks)).toEqual([
      'internal',
    ]);
    expect(createObjectStorageService(config).ports).toBeUndefined();
  });

  test('both backend tiers are pointed at it in both pipelines', () => {
    for (const tier of ['backend-api', 'backend-worker'] as const) {
      expect(
        compose.services[tier]?.environment?.OBJECT_STORE_ENDPOINT,
      ).toContain('object-store');
    }
    for (const service of [
      createBackendApiService(config),
      createBackendWorkerService(config),
    ]) {
      expect(service.environment?.OBJECT_STORE_ENDPOINT).toContain(
        'object-store',
      );
    }
  });

  test('both pipelines publish the store at its bucket path', () => {
    // Presigned URLs go to the BROWSER, so the store needs a public origin —
    // the proxy forwards `/<bucket>/*` UNSTRIPPED (SigV4 covers host + path).
    // The proxy learns the bucket from env in both pipelines; compose sets it
    // explicitly, `tale deploy`'s proxy reads the same `.env` the backend
    // tiers do, and the entrypoint defaults to `tale-blobs` either way.
    expect(compose.services.proxy?.environment?.OBJECT_STORE_BUCKET).toContain(
      'tale-blobs',
    );
    const entrypoint = readFileSync(
      resolve(repoRoot, 'services/proxy/docker-entrypoint.sh'),
      'utf8',
    );
    expect(entrypoint).toContain('handle /${OBJECT_STORE_BUCKET}/*');
    // Stripping the prefix or rewriting the URI would invalidate every
    // signature — assert the route proxies verbatim.
    const route = entrypoint.slice(
      entrypoint.indexOf('handle /${OBJECT_STORE_BUCKET}/*'),
    );
    const body = route.slice(0, route.indexOf('\n\t}'));
    expect(body).not.toContain('strip_prefix');
    expect(body).not.toContain('rewrite');
  });

  test('the proxy injects the backend lanes unconditionally', () => {
    // BACKEND_UPSTREAM began as the cutover's reversibility switch; with the
    // Convex runtime gone, "unset" must mean the DEFAULT backend, not
    // "skip the lanes" — v0.5.0 shipped the skip: uploads (/<bucket>/*),
    // live updates (/events) and every machine door 404'd under `tale
    // deploy`, which never set the variable.
    const entrypoint = readFileSync(
      resolve(repoRoot, 'services/proxy/docker-entrypoint.sh'),
      'utf8',
    );
    expect(entrypoint).toContain(
      'BACKEND_UPSTREAM="${BACKEND_UPSTREAM:-backend-api:3005}"',
    );
    expect(entrypoint).not.toContain('-n "${BACKEND_UPSTREAM');
  });

  test('nothing routes to the retired runtime any more', () => {
    // The proxy used to fall back to `convex:*` for everything the backend
    // list did not name. That service is gone, so a fallback is a 502 — every
    // remaining lane must resolve to something that exists.
    const caddyfile = readFileSync(
      resolve(repoRoot, 'services/proxy/Caddyfile'),
      'utf8',
    );
    expect(caddyfile).not.toContain('convex');
  });

  test('the WebDAV door refuses dot-segments at the edge like the API lanes', () => {
    // The platform's URL parser folds `..` / `%2e%2e` before the WebDAV
    // path parser sees them, so a PUT through `<folder>/%2E%2E/x` landed
    // one level up. The API rule lives in the entrypoint's injected block;
    // the WebDAV handle never moved there, so its twin sits in the static
    // Caddyfile — ahead of `handle /dav/*`, and matching the same raw-URI
    // grammar, so the two never drift apart.
    const caddyfile = readFileSync(
      resolve(repoRoot, 'services/proxy/Caddyfile'),
      'utf8',
    );
    const entrypoint = readFileSync(
      resolve(repoRoot, 'services/proxy/docker-entrypoint.sh'),
      'utf8',
    );
    const dotGrammar = (source: string, matcher: string): string => {
      const line = source
        .split(/\r?\n/)
        .find((candidate) => candidate.includes(`@${matcher} expression`));
      expect(line).toBeDefined();
      return (line ?? '')
        .slice((line ?? '').indexOf('&&'))
        .replace(/[\\`]+$/, '');
    };
    const davRule = caddyfile.indexOf('@davDotSegments expression');
    const davRefusal = caddyfile.indexOf('handle @davDotSegments {');
    const davHandle = caddyfile.indexOf('handle /dav/* {');
    expect(davRule).toBeGreaterThan(-1);
    expect(davRefusal).toBeGreaterThan(davRule);
    expect(davHandle).toBeGreaterThan(davRefusal);
    expect(
      caddyfile
        .slice(davRefusal, davHandle)
        .includes('respond "Not found" 404'),
    ).toBe(true);
    expect(caddyfile).toContain(
      '(path("/dav/*") || {http.request.uri}.matches("(?i)^(/[^/?]+)?/dav/"))',
    );
    // The entrypoint escapes its backticks for the heredoc; past the
    // closing backtick the grammar after `&&` compares byte for byte.
    expect(dotGrammar(caddyfile, 'davDotSegments')).toBe(
      dotGrammar(entrypoint, 'apiDotSegments'),
    );
  });

  test('the CLI refuses to boot the store on a default credential', () => {
    // `tale deploy` auto-generates OBJECT_STORE_SECRET_KEY into .env; the
    // `:?` form makes a missing one fail the compose up instead of silently
    // standing up a world-writable store on a published default.
    const password =
      createObjectStorageService(config).environment?.MINIO_ROOT_PASSWORD;
    expect(password).toContain('OBJECT_STORE_SECRET_KEY:?');
  });
});

describe('service → image parity', () => {
  // The bug this locks down: `tale deploy` derived its pull list mechanically
  // as `tale-${service}` while the backend tier runs the platform image, so
  // v0.5.0's first fresh deploy pulled two images that were never built
  // (tale-backend-api, tale-backend-worker) and aborted. Service → image now
  // goes through imageRef/imageRepoForService for the compose creators AND
  // the deploy pull list; these tests hold the map to what actually exists.

  test('the backend tier maps to the platform image', () => {
    expect(imageRepoForService('backend-api')).toBe('tale-platform');
    expect(imageRepoForService('backend-worker')).toBe('tale-platform');
  });

  test('every generated tale image matches imageRef for its service', () => {
    const stateful = parse(generateStatefulCompose(config, 'localhost')) as {
      services: Record<string, { image?: string }>;
    };
    const taleImageServices = Object.entries(stateful.services).filter(
      ([, svc]) => svc.image?.startsWith(`${config.registry}/`),
    );
    expect(taleImageServices.length).toBeGreaterThan(0);
    for (const [name, svc] of taleImageServices) {
      if (!isValidService(name)) {
        throw new Error(`unexpected tale-image service: ${name}`);
      }
      expect(svc.image).toBe(imageRef(config, name));
    }
  });

  test('CLI backend services set every env key compose.yml sets', () => {
    // The bug this locks down: compose.yml wired DATABASE_URL into the
    // backend tier but the CLI generator did not, so a `tale deploy` stack
    // crash-looped on the env schema while `docker compose up` worked.
    // Values may differ (the CLI fails closed on DB_PASSWORD); the KEY set
    // must not drift.
    const cliServices = {
      'backend-api': createBackendApiService(config),
      'backend-worker': createBackendWorkerService(config),
    } as const;
    for (const [name, cliService] of Object.entries(cliServices)) {
      const composeEnv = compose.services[name]?.environment ?? {};
      const cliEnv = cliService.environment ?? {};
      for (const key of Object.keys(composeEnv)) {
        expect(`${name}:${key}:${key in cliEnv}`).toBe(`${name}:${key}:true`);
      }
    }
  });

  test('every service image repo is one release.yml actually builds', () => {
    // The pull list can only name images the release pipeline pushes — this
    // is the cross-artifact fact the v0.5.0 deploy regression violated.
    const releaseYml = readFileSync(
      resolve(repoRoot, '.github/workflows/release.yml'),
      'utf8',
    );
    const built = new Set(resolveRelease(releaseYml, false).services);
    expect(built.size).toBeGreaterThan(0);
    const taleServices = ALL_SERVICES.filter(
      (
        s,
      ): s is Exclude<
        (typeof ALL_SERVICES)[number],
        keyof typeof THIRD_PARTY_IMAGES
      > => !(s in THIRD_PARTY_IMAGES), // third-party pins aren't built here
    );
    for (const service of taleServices) {
      const repo = imageRepoForService(service).replace(/^tale-/, '');
      expect(built).toContain(repo);
    }
  });

  test('a content-site release publishes all three sites and skips platform release jobs', () => {
    const releaseYml = readFileSync(
      resolve(repoRoot, '.github/workflows/release.yml'),
      'utf8',
    );
    const resolved = resolveRelease(releaseYml, true);
    expect(resolved.services).toEqual(['web', 'docs', 'ui-docs']);
    expect(resolved.version).toBe('0.5.15-sites.1');
    const workflow = parse(releaseYml) as {
      jobs: Record<string, { if?: string }>;
    };
    for (const job of ['create-release', 'trigger-cli']) {
      expect(workflow.jobs[job]?.if).toBe(
        "needs.prepare.outputs.sites_only != 'true'",
      );
    }
  });

  test('the object-store pin is one value, shared by every lane', () => {
    // compose.yml, the CLI creator, and the deploy pull list must agree on
    // the minio pin; THIRD_PARTY_IMAGES is the source the CLI lanes share and
    // this holds compose.yml to it.
    expect(createObjectStorageService(config).image).toBe(
      THIRD_PARTY_IMAGES['object-store'],
    );
    expect(compose.services['object-store']?.image).toBe(
      THIRD_PARTY_IMAGES['object-store'],
    );
    // Compose and the deploy pre-pull must request the same manifest.
    const platform = imagePlatform(THIRD_PARTY_IMAGES['object-store']);
    expect(createObjectStorageService(config).platform).toBe(platform);
    expect(compose.services['object-store']?.platform).toBe(platform);
  });
});

/** Exercise the workflow's version/matrix script, not a second service list. */
function resolveRelease(source: string, sitesOnly: boolean) {
  const workflow = parse(source) as {
    jobs: { prepare: { steps: { id?: string; run: string }[] } };
  };
  const script = workflow.jobs.prepare.steps.find(
    (step) => step.id === 'version',
  )?.run;
  if (!script) throw new Error('Release version step is missing');
  const directory = mkdtempSync(resolve(tmpdir(), 'tale-release-matrix-'));
  const output = resolve(directory, 'output');
  try {
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        EVENT_NAME: 'workflow_dispatch',
        INPUT_VERSION: 'v0.5.15-sites.1',
        SITES_ONLY: String(sitesOnly),
        GITHUB_OUTPUT: output,
      },
    });
    expect(result.status).toBe(0);
    const lines = Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => [
          line.slice(0, line.indexOf('=')),
          line.slice(line.indexOf('=') + 1),
        ]),
    );
    return {
      services: JSON.parse(lines.service_names as string) as string[],
      version: lines.version_number,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('release artifact identity', () => {
  type Step = {
    name?: string;
    id?: string;
    if?: string;
    run?: string;
    uses?: string;
    env?: Record<string, string | number>;
    with?: Record<string, string | boolean>;
  };
  const workflow = (name: string) =>
    parse(
      readFileSync(resolve(repoRoot, `.github/workflows/${name}.yml`), 'utf8'),
    ) as {
      jobs: Record<
        string,
        {
          steps: Step[];
          needs?: string[];
          strategy?: {
            matrix: {
              arch: { name: string; platform: string; runner: string }[];
            };
          };
        }
      >;
    };
  const release = workflow('release');
  const cli = workflow('cli');
  const build = workflow('build');
  const shell = (script: string, env: Record<string, string> = {}) =>
    spawnSync(
      process.platform === 'darwin' ? '/bin/bash' : 'bash',
      ['-euo', 'pipefail', '-c', script],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, SKIP_BUILD: '', PULL_POLICY: '', ...env },
      },
    );

  /** The Build lanes pull each image by the digest its build job recorded
   * (one receipt per image) and check its revision label; the release lane
   * pulls its version tags. Either way the stand-in `docker` logs the pulls
   * and tags, and answers an inspect with the source commit. */
  const CI_DIGEST = `sha256:${'a'.repeat(64)}`;
  const CI_SOURCE = 'b'.repeat(40);
  const CI_REGISTRY = 'ghcr.io/tale-project/tale';
  const revisionFormat =
    '{{ index .Config.Labels "org.opencontainers.image.revision" }}';
  const prepareImages = (
    step: Step,
    services: string[],
    yieldBetweenArguments = false,
  ) => {
    const directory = mkdtempSync(resolve(tmpdir(), 'tale-image-receipts-'));
    const receipts = resolve(directory, 'image-receipts');
    const log = resolve(directory, 'docker-calls');
    let result: ReturnType<typeof shell>;
    let calls: string[][];
    try {
      let jqExecutable = '';
      mkdirSync(receipts);
      writeFileSync(log, '');
      // The actual helper launches Docker from child Bash workers. An
      // in-shell function would neither reach them nor write coherent records
      // when its multiple printf calls overlap another service's calls.
      writeFileSync(
        resolve(directory, 'docker'),
        String.raw`#!/usr/bin/env bash
set -eu
record=DOCKER
for argument in "$@"; do
  record+=$'\t'"$argument"
  if [ "$TEST_DOCKER_YIELD" = 'true' ]; then sleep 0.01; fi
done
printf '%s\n' "$record" >> "$TEST_DOCKER_LOG"
if [ "$1 $2" = 'image inspect' ]; then
  printf '%s\n' "$TEST_REVISION"
fi
`,
        { mode: 0o755 },
      );
      // A wrapper executable, rather than a shell function, also reaches
      // the child helper and keeps native jq.exe's Windows output at LF.
      if (process.platform === 'win32') {
        const jq = shell('command -v jq');
        expect(jq.status, jq.stderr).toBe(0);
        writeFileSync(
          resolve(directory, 'jq'),
          '#!/usr/bin/env bash\nexec "$TEST_JQ_EXECUTABLE" --binary "$@"\n',
          { mode: 0o755 },
        );
        jqExecutable = jq.stdout.trim();
      }
      for (const service of services) {
        writeFileSync(
          resolve(receipts, `${service}.json`),
          JSON.stringify({
            service,
            image: `${CI_REGISTRY}/tale-${service}`,
            tag: '0.5.43-amd64',
            digest: CI_DIGEST,
            revision: CI_SOURCE,
          }),
        );
      }
      const context = {
        env: { REGISTRY: 'ghcr.io' },
        github: { repository: 'tale-project/tale', sha: CI_SOURCE },
        needs: {
          prepare: {
            outputs: {
              version_number: '0.5.43',
              service_names: JSON.stringify(services),
            },
          },
          changes: { outputs: { source_sha: CI_SOURCE, candidate_sha: '' } },
        },
        runner: { temp: directory.replaceAll('\\', '/') },
      };
      const expand = (value: string | number) =>
        String(value).replace(
          /\$\{\{\s*(.*?)\s*\}\}/g,
          (_match, expression: string) =>
            String(runInNewContext(expression, context)),
        );
      const environment = Object.fromEntries(
        Object.entries(step.env ?? {}).map(([key, value]) => [
          key,
          expand(value),
        ]),
      );
      expect(environment.REGISTRY_PATH).toBe(CI_REGISTRY);
      expect(environment.SOURCE_SHA).toBe(CI_SOURCE);
      if (environment.RECEIPTS) {
        expect(environment.RECEIPTS).toBe(receipts.replaceAll('\\', '/'));
        expect(environment.PULL_HELPER).toBe(
          '.github/scripts/pull-ci-images.sh',
        );
      } else {
        expect(environment.SERVICE_NAMES).toBe(JSON.stringify(services));
        expect(environment.IMAGE_TAG).toBe('0.5.43-amd64');
      }
      result = shell(expand(step.run!), {
        PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
        RECEIPTS: '',
        IMAGE_TAG: '',
        TEST_DOCKER_LOG: log.replaceAll('\\', '/'),
        TEST_DOCKER_YIELD: String(yieldBetweenArguments),
        TEST_REVISION: CI_SOURCE,
        TEST_JQ_EXECUTABLE: jqExecutable,
        ...environment,
      });
      calls = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          expect(line).toStartWith('DOCKER\t');
          return line.split('\t').slice(1);
        });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const images = new Map<string, string>();
    const verified = new Set<string>();
    for (const [command, ...arguments_] of calls) {
      const source = command === 'image' ? arguments_[3] : arguments_[0];
      const target = arguments_[1];
      expect(source).toBeDefined();
      if (command === 'pull') {
        expect(images.has(source!)).toBe(false);
        images.set(source!, source!);
      } else if (command === 'image') {
        expect(arguments_.slice(0, 3)).toEqual([
          'inspect',
          '--format',
          revisionFormat,
        ]);
        expect(images.has(source!)).toBe(true);
        expect(verified.has(source!)).toBe(false);
        verified.add(source!);
      } else {
        expect(command).toBe('tag');
        if (!images.has(source!))
          throw new Error(`Image tag source was never pulled: ${source}`);
        expect(verified.has(source!)).toBe(true);
        expect(target).toBeDefined();
        images.set(target!, images.get(source!)!);
      }
    }
    expect(verified.size).toBeGreaterThan(0);
    for (const source of verified) {
      const repository = source.split('@')[0]!.replace(/:[^/]*$/, '');
      const service = repository.slice(`${CI_REGISTRY}/tale-`.length);
      expect(services).toContain(service);
      const ownCalls = calls.filter((call) =>
        call[0] === 'image' ? call[4] === source : call[1] === source,
      );
      expect(ownCalls).toEqual([
        ['pull', source],
        ['image', 'inspect', '--format', revisionFormat, source],
        ['tag', source, `${repository}:latest`],
        ...(['sandbox-runtime', 'sandbox-buildkitd'].includes(service)
          ? [['tag', source, `tale-${service}:latest`]]
          : []),
      ]);
    }
    const lastScopedTag = calls.findLastIndex(
      (call) => call[0] === 'tag' && call[2]?.startsWith(`${CI_REGISTRY}/`),
    );
    for (const [index, call] of calls.entries()) {
      if (call[0] === 'tag' && call[2]?.startsWith('tale-'))
        expect(index).toBeGreaterThan(lastScopedTag);
    }
    return images;
  };
  const releasePull = release.jobs['container-test']!.steps.find(
    (step) => step.name === 'Pull release images',
  )!;
  const releaseMatrix = (sitesOnly: boolean) =>
    resolveRelease(
      readFileSync(resolve(repoRoot, '.github/workflows/release.yml'), 'utf8'),
      sitesOnly,
    ).services;

  test('identity evidence still rejects an alias whose source was never pulled', () => {
    const source = `ghcr.io/tale-project/tale/tale-platform@${CI_DIGEST}`;
    expect(() =>
      prepareImages(
        {
          ...releasePull,
          run: `docker tag ${source} ghcr.io/tale-project/tale/tale-platform:latest`,
        },
        [],
      ),
    ).toThrow(`Image tag source was never pulled: ${source}`);
  });

  test.each(['smoke-test', 'image-validate', 'release'])(
    '%s retains complete image identity records when concurrent workers yield between arguments',
    (job) => {
      const source =
        job === 'release'
          ? releasePull
          : build.jobs[job]!.steps.find(
              (step) => step.name === 'Pull images from GHCR',
            )!;
      // The external Docker executable yields while constructing a record,
      // then appends it once. This exercises the actual helper's child
      // workers without relying on inherited shell functions or global order.
      const images = prepareImages(source, releaseMatrix(false), true);
      expect(images.get('tale-sandbox-runtime:latest')).toBe(
        job === 'release'
          ? 'ghcr.io/tale-project/tale/tale-sandbox-runtime:0.5.43-amd64'
          : `ghcr.io/tale-project/tale/tale-sandbox-runtime@${CI_DIGEST}`,
      );
    },
  );

  test.each(['smoke-test', 'image-validate'])(
    'release prepares every image alias used by the green Build %s lane',
    (job) => {
      const services = releaseMatrix(false);
      const released = prepareImages(releasePull, services);
      const tested = prepareImages(
        build.jobs[job]!.steps.find(
          (step) => step.name === 'Pull images from GHCR',
        )!,
        services,
      );
      const repositoryOf = (image: string) =>
        image.split('@')[0]!.replace(/:[^/]*$/, '');
      for (const [alias, source] of tested) {
        if (alias === source) continue;
        expect(source).toEndWith(`@${CI_DIGEST}`);
        expect(released.get(alias)).toBe(
          `${repositoryOf(source)}:0.5.43-amd64`,
        );
      }
    },
  );

  test.each(['SANDBOX_RUNTIME_IMAGE', 'SANDBOX_BUILDKITD_IMAGE'])(
    'release prepares the pulled image at the spawner default %s',
    (key) => {
      const alias =
        compose.services.sandbox!.environment![key]!.match(
          /^\$\{[^:]+:-(.+)\}$/,
        )?.[1];
      expect(alias).toBeDefined();
      expect(prepareImages(releasePull, releaseMatrix(false)).get(alias!)).toBe(
        `ghcr.io/tale-project/tale/${alias!.replace(':latest', ':0.5.43-amd64')}`,
      );
    },
  );

  test('a site-only release prepares only its selected image aliases', () => {
    const services = releaseMatrix(true);
    expect([...prepareImages(releasePull, services).keys()].sort()).toEqual(
      services
        .flatMap((service) => [
          `ghcr.io/tale-project/tale/tale-${service}:0.5.43-amd64`,
          `ghcr.io/tale-project/tale/tale-${service}:latest`,
        ])
        .sort(),
    );
  });

  test.each([
    [false, ''],
    [false, 'image'],
    [false, 'smoke'],
    [false, 'web'],
    [false, 'docs'],
    [false, 'ui-docs'],
    [false, 'ai-gateway'],
    [true, ''],
    [true, 'web'],
    [true, 'docs'],
    [true, 'ui-docs'],
  ] as const)(
    'release container checks retain pulled images and await every child with sites_only=%s when %s fails',
    (sitesOnly, failed) => {
      const steps = release.jobs['container-test']!.steps.filter((step) =>
        step.run?.includes('services/platform/tests/integration/'),
      );
      expect(steps.map((step) => step.name)).toEqual([
        'Run stack validation',
        'Run standalone container tests',
      ]);
      expect(steps[0]!.if).toBe("needs.prepare.outputs.sites_only != 'true'");
      // image, smoke, web, docs, ui-docs, ai-gateway. Keep all six actual
      // commands: combining steps must not remove a container check.
      const groups = [
        ['image', 'smoke'],
        ['web', 'docs', 'ui-docs', ...(sitesOnly ? [] : ['ai-gateway'])],
      ];
      const directory = mkdtempSync(resolve(tmpdir(), 'tale-release-checks-'));
      const log = resolve(directory, 'calls');
      try {
        writeFileSync(log, '');
        writeFileSync(
          resolve(directory, 'bun'),
          `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = run ]; then shift; fi
test "$#" -eq 1
SERVICE="$(basename "$1" .ts)"
SERVICE="\${SERVICE#container-}"
SERVICE="\${SERVICE%-test}"
printf '%s\\t%s\\t%s\\n' "$SKIP_BUILD" "$PULL_POLICY" "$1" >> "$TEST_VALIDATION_LOG"
touch "$TEST_VALIDATION_DIR/\${SERVICE}.start"
for ((ATTEMPT = 0; ATTEMPT < 1000; ATTEMPT++)); do
  READY=1
  for REQUIRED in $TEST_VALIDATION_GROUP; do
    if [ ! -f "$TEST_VALIDATION_DIR/\${REQUIRED}.start" ]; then READY=0; fi
  done
  if [ "$READY" -eq 1 ]; then break; fi
  sleep 0.01
done
test "$READY" -eq 1
printf 'CHECK %s\\n' "$SERVICE"
touch "$TEST_VALIDATION_DIR/\${SERVICE}.finish"
if [ "$SERVICE" = "$TEST_FAILED_VALIDATION" ]; then exit 37; fi
`,
          { mode: 0o755 },
        );
        for (const [index, step] of steps.entries()) {
          if (sitesOnly && index === 0) continue;
          const group = groups[index]!;
          const environment = Object.fromEntries(
            Object.entries(step.env ?? {}).map(([key, value]) => [
              key,
              key === 'SITES_ONLY' ? String(sitesOnly) : String(value),
            ]),
          );
          expect(environment.SKIP_BUILD).toBe('true');
          expect(environment.PULL_POLICY).toBe('never');
          if (index === 0) expect(environment.SMOKE_TEST_TIMEOUT).toBe('300');
          else
            expect(step.env?.SITES_ONLY).toBe(
              '${{ needs.prepare.outputs.sites_only }}',
            );
          const result = shell(step.run!, {
            ...environment,
            PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
            RUNNER_TEMP: directory.replaceAll('\\', '/'),
            TEST_VALIDATION_DIR: directory.replaceAll('\\', '/'),
            TEST_VALIDATION_LOG: log.replaceAll('\\', '/'),
            TEST_VALIDATION_GROUP: group.join(' '),
            TEST_FAILED_VALIDATION: failed,
          });
          expect(result.status, result.stderr + result.stdout).toBe(
            group.includes(failed) ? 1 : 0,
          );
          for (const service of group) {
            expect(existsSync(resolve(directory, `${service}.finish`))).toBe(
              true,
            );
            expect(result.stdout).toContain(`CHECK ${service}\n`);
          }
        }
        expect(readFileSync(log, 'utf8').trim().split('\n').sort()).toEqual(
          groups
            .slice(sitesOnly ? 1 : 0)
            .flat()
            .map(
              (service) =>
                `true\tnever\tservices/platform/tests/integration/container-${service}-test.ts`,
            )
            .sort(),
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  const documentStep = () => {
    const step = release.jobs.build!.steps.find(
      (entry) => entry.name === 'Verify native document tools',
    );
    if (!step?.run) throw new Error('Native document release gate is missing');
    return step;
  };
  const documentDigest = `sha256:${'a'.repeat(64)}`;
  const documentImage = (arch: string) =>
    `ghcr.io/synthetic/tale/tale-sandbox-runtime:0.5.44-${arch}@${documentDigest}`;
  type DocumentInput = {
    uid: number;
    architecture: string;
    versions: Record<string, string>;
    requirementsSha256: string;
    nodeCheck: string;
    nodeVersions: Record<string, string>;
    nodeLockSha256: string;
    xls: { base64: string; sha256: string };
    xlsx: { base64: string; sha256: string };
  };
  type DocumentEvent = {
    phase: 'start' | 'finish';
    uid: string;
    command?: string[];
    input?: DocumentInput;
  };
  const documentCapture = String.raw`
    import { mock } from 'bun:test';
    import { appendFileSync } from 'node:fs';
    const execPath = process.env.TEST_DOCUMENT_EXEC;
    const exec = await import(execPath);
    const started = new Set();
    const record = event => appendFileSync(process.env.TEST_DOCUMENT_LOG, JSON.stringify(event) + '\n');
    // Keep the real helper, repository resolver and fixture reads. Only the
    // process boundary is replaced so no Docker daemon or image is needed.
    mock.module(execPath, () => ({
      ...exec,
      capture: async (command, options) => {
        const uid = command[command.indexOf('--user') + 1].split(':')[0];
        started.add(uid);
        record({ phase: 'start', uid, command, input: JSON.parse(options.stdin) });
        for (let attempt = 0; started.size !== 2; attempt++) {
          if (attempt === 99) throw new Error('Document users did not start concurrently');
          await Bun.sleep(10);
        }
        await Bun.sleep(uid === '65534' ? 5 : 40);
        record({ phase: 'finish', uid });
        return {
          exitCode: 0,
          stdout: 'CHECK ' + uid,
          stderr: '',
          combined: 'CHECK ' + uid,
        };
      },
    }));
  `;
  const runDocumentGate = (
    arch: string,
    overrides: Record<string, string> = {},
    actualHelper = false,
  ) => {
    const directory = mkdtempSync(resolve(tmpdir(), 'tale-document-gate-'));
    const module = resolve(directory, 'document-tools.ts');
    const log = resolve(directory, 'document-calls');
    const environment = {
      DOCUMENT_IMAGE: documentImage(arch),
      DOCUMENT_PLATFORM: `linux/${arch}`,
      DOCUMENT_REVISION: 'b'.repeat(40),
      DOCUMENT_VERSION: '0.5.44',
      DOCUMENT_SOURCE: 'https://github.com/synthetic/tale',
      ACTUAL_REVISION: 'b'.repeat(40),
      ACTUAL_VERSION: '0.5.44',
      ACTUAL_SOURCE: 'https://github.com/synthetic/tale',
      PULL_EXIT: '0',
      INSPECT_EXIT: '0',
      FAIL_UID: '',
      REJECT_UID: '',
      ...overrides,
    };
    try {
      writeFileSync(log, '');
      writeFileSync(
        module,
        `export async function checkDocumentTools(image: string, uid: number, platform: string) {
  if (image !== process.env.DOCUMENT_IMAGE || platform !== process.env.DOCUMENT_PLATFORM || ![65534, 10001].includes(uid)) throw new Error('Wrong document identity');
  await Bun.write(process.env.TEST_DOCUMENT_DIR + '/' + uid + '.start', '');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await Bun.file(process.env.TEST_DOCUMENT_DIR + '/65534.start').exists() && await Bun.file(process.env.TEST_DOCUMENT_DIR + '/10001.start').exists()) break;
    if (attempt === 99) throw new Error('Document users did not start concurrently');
    await Bun.sleep(10);
  }
  await Bun.sleep(uid === 65534 ? 5 : 40);
  await Bun.write(process.env.TEST_DOCUMENT_DIR + '/' + uid + '.finish', '');
  if (String(uid) === process.env.REJECT_UID) throw new Error('Rejected document uid ' + uid);
  return {
    exitCode: String(uid) === process.env.FAIL_UID ? 92 : 0,
    combined: ['CHECK', uid, platform, image].join(' '),
  };
}\n`,
      );
      const importStatement =
        'import { checkDocumentTools } from "./services/platform/tests/integration/lib/document-tools.ts";';
      const script = documentStep().run!;
      expect(script).toContain(importStatement);
      // Execute the actual allSettled command, replacing only its offline
      // container boundary. Identity admission and both UID decisions stay real.
      const result = shell(
        String.raw`
        docker() {
          case "$1 $2" in
            'pull --platform')
              test "$#" -eq 4 || return 90
              test "$3" = "$DOCUMENT_PLATFORM" || return 90
              test "$4" = "$DOCUMENT_IMAGE" || return 90
              printf 'PULL %s %s\n' "$3" "$4"
              return "$PULL_EXIT"
              ;;
            'image inspect')
              test "$#" -eq 5 || return 90
              test "$3" = '--format' || return 90
              test "$5" = "$DOCUMENT_IMAGE" || return 90
              test "$4" = '{{json .Config.Labels}}' || return 90
              printf '%s\n' "$TEST_DOCUMENT_LABELS"
              return "$INSPECT_EXIT"
              ;;
            *) return 91 ;;
          esac
        }
        bun() {
          test "$#" -eq 2 || return 90
          test "$1" = '-e' || return 90
          "$TEST_BUN_EXECUTABLE" -e "$TEST_DOCUMENT_CAPTURE"$'\n'"$2"
        }
      ` +
          script.replace(
            importStatement,
            actualHelper
              ? 'const { checkDocumentTools } = await import(process.env.TEST_DOCUMENT_HELPER);'
              : `import { checkDocumentTools } from ${JSON.stringify(pathToFileURL(module).href)};`,
          ),
        {
          ...environment,
          TEST_BUN_EXECUTABLE: process.execPath.replaceAll('\\', '/'),
          TEST_DOCUMENT_DIR: directory,
          TEST_DOCUMENT_LOG: log.replaceAll('\\', '/'),
          TEST_DOCUMENT_CAPTURE: actualHelper ? documentCapture : '',
          TEST_DOCUMENT_EXEC: pathToFileURL(
            resolve(
              repoRoot,
              'services/platform/tests/integration/lib/exec.ts',
            ),
          ).href,
          TEST_DOCUMENT_HELPER: pathToFileURL(
            resolve(
              repoRoot,
              'services/platform/tests/integration/lib/document-tools.ts',
            ),
          ).href,
          TEST_DOCUMENT_LABELS:
            overrides.TEST_DOCUMENT_LABELS ??
            JSON.stringify({
              'org.opencontainers.image.revision': environment.ACTUAL_REVISION,
              'org.opencontainers.image.version': environment.ACTUAL_VERSION,
              'org.opencontainers.image.source': environment.ACTUAL_SOURCE,
            }),
        },
      );
      return {
        ...result,
        events: readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as DocumentEvent),
        startedUids: ['65534', '10001'].filter((uid) =>
          existsSync(resolve(directory, `${uid}.start`)),
        ),
        finishedUids: ['65534', '10001'].filter((uid) =>
          existsSync(resolve(directory, `${uid}.finish`)),
        ),
      };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };

  test('native document conformance gates both release manifests on built bytes', () => {
    const job = release.jobs.build!;
    const step = documentStep();
    const image = job.steps.find((entry) => entry.name === 'Build and push')!;
    const setup = job.steps.find(
      (entry) => entry.name === 'Setup Bun for document checks',
    )!;
    expect(job.strategy?.matrix.arch).toEqual([
      { name: 'amd64', runner: 'ubuntu-latest', platform: 'linux/amd64' },
      { name: 'arm64', runner: 'ubuntu-24.04-arm', platform: 'linux/arm64' },
    ]);
    expect(image.id).toBe('image');
    expect(image.with?.push).toBe(true);
    expect(step.env).toEqual({
      DOCUMENT_IMAGE:
        '${{ env.REGISTRY }}/${{ github.repository }}/tale-sandbox-runtime:${{ needs.prepare.outputs.version_number }}-${{ matrix.arch.name }}@${{ steps.image.outputs.digest }}',
      DOCUMENT_PLATFORM: '${{ matrix.arch.platform }}',
      DOCUMENT_REVISION: '${{ steps.meta.outputs.revision }}',
      DOCUMENT_VERSION: '${{ needs.prepare.outputs.version_number }}',
      DOCUMENT_SOURCE: '${{ github.server_url }}/${{ github.repository }}',
    });
    expect(setup.uses).toBe(
      'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6',
    );
    expect(setup.with?.['bun-version']).toBe('1.4.2');
    expect(step.if).toBe("matrix.service.name == 'sandbox-runtime'");
    expect(setup.if).toBe(step.if);
    expect(job.steps.indexOf(image)).toBeLessThan(job.steps.indexOf(setup));
    expect(job.steps.indexOf(setup)).toBeLessThan(job.steps.indexOf(step));
    expect(release.jobs.manifest!.needs).toContain('build');
    expect(releaseMatrix(true)).not.toContain('sandbox-runtime');
    expect(step.run).toContain(
      'import { checkDocumentTools } from "./services/platform/tests/integration/lib/document-tools.ts"',
    );
    expect(step.run).toContain('checkDocumentTools(image, uid, platform)');
    expect(step.run).toContain('const uids = [65534, 10001]');
    expect(step.run).toContain('await Promise.allSettled(');
    expect(step.run).toContain('if (check.status === "rejected")');
    expect(step.run).toContain('failed ||= check.value.exitCode !== 0');
    expect(step.run).toContain('if (failed) process.exitCode = 1');
  });

  test.each(['amd64', 'arm64'])(
    'native %s document gate executes both session users against the immutable image',
    (arch) => {
      const result = runDocumentGate(arch);
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual([
        `PULL linux/${arch} ${documentImage(arch)}`,
        'Document tools as uid 65534',
        `CHECK 65534 linux/${arch} ${documentImage(arch)}`,
        'Document tools as uid 10001',
        `CHECK 10001 linux/${arch} ${documentImage(arch)}`,
      ]);
      expect(result.finishedUids).toEqual(['65534', '10001']);
    },
  );

  // The integration helper's repository pathname targets the native Unix
  // Docker hosts. Windows retains the workflow identity/scheduling fixtures
  // above; this executes the unmodified helper and its actual source reads.
  test.skipIf(process.platform === 'win32').each(['amd64', 'arm64'])(
    'native %s document helper preserves the offline resource and stdin contract',
    (arch) => {
      const result = runDocumentGate(arch, {}, true);
      expect(result.status, result.stderr + result.stdout).toBe(0);
      expect(result.events.map((event) => event.phase)).toEqual([
        'start',
        'start',
        'finish',
        'finish',
      ]);
      const requests = result.events.filter((event) => event.phase === 'start');
      expect(requests.map((event) => event.uid).sort()).toEqual([
        '10001',
        '65534',
      ]);
      expect(
        result.events
          .filter((event) => event.phase === 'finish')
          .map((event) => event.uid)
          .sort(),
      ).toEqual(['10001', '65534']);
      const requirements = readFileSync(
        resolve(
          repoRoot,
          'services/sandbox-runtime/document-python-requirements.txt',
        ),
      );
      const nodeLock = readFileSync(
        resolve(
          repoRoot,
          'services/sandbox-runtime/document-node/package-lock.json',
        ),
      );
      const nodeManifest = JSON.parse(
        readFileSync(
          resolve(
            repoRoot,
            'services/sandbox-runtime/document-node/package.json',
          ),
          'utf8',
        ),
      ) as { dependencies: Record<string, string> };
      const versions = Object.fromEntries(
        [
          ...requirements
            .toString('utf8')
            .matchAll(/^(\S+)==(\S+) --hash=sha256:/gm),
        ].map((match) => [match[1], match[2]]),
      );
      for (const request of requests) {
        const command = request.command!;
        expect(command.slice(0, -2)).toEqual([
          'docker',
          'run',
          '--rm',
          '-i',
          '--platform',
          `linux/${arch}`,
          '--network',
          'none',
          '--read-only',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges',
          '--memory',
          '1g',
          '--pids-limit',
          '128',
          '--user',
          `${request.uid}:${request.uid}`,
          '--tmpfs',
          `/tmp:uid=${request.uid},gid=${request.uid},mode=700`,
          '--env',
          'PYTHONDONTWRITEBYTECODE=1',
          '--env',
          'PIP_NO_INDEX=1',
          '--env',
          'OPENBLAS_NUM_THREADS=1',
          '--env',
          'OMP_NUM_THREADS=1',
          '--env',
          'VIPS_CONCURRENCY=1',
          '--entrypoint',
          'python3',
          documentImage(arch),
        ]);
        expect(command.at(-2)).toBe('-c');
        expect(command.at(-1)).toContain('data = json.load(sys.stdin)');
        expect(command.at(-1)).toContain('signal.alarm(120)');
        const input = request.input!;
        expect(Object.keys(input).sort()).toEqual([
          'architecture',
          'nodeCheck',
          'nodeLockSha256',
          'nodeVersions',
          'requirementsSha256',
          'uid',
          'versions',
          'xls',
          'xlsx',
        ]);
        expect(input.uid).toBe(Number(request.uid));
        expect(input.architecture).toBe(
          arch === 'amd64' ? 'x86_64' : 'aarch64',
        );
        expect(Object.keys(versions).length).toBeGreaterThan(0);
        expect(input.versions).toEqual(versions);
        expect(input.requirementsSha256).toBe(
          createHash('sha256').update(requirements).digest('hex'),
        );
        expect(input.nodeVersions).toEqual(nodeManifest.dependencies);
        expect(input.nodeLockSha256).toBe(
          createHash('sha256').update(nodeLock).digest('hex'),
        );
        expect(input.nodeCheck).toContain("require('node:assert/strict')");
        for (const extension of ['xls', 'xlsx'] as const) {
          const fixture = readFileSync(
            resolve(
              repoRoot,
              `services/platform/tests/integration/fixtures/document-tools/workbook.${extension}`,
            ),
          );
          expect(input[extension]).toEqual({
            base64: fixture.toString('base64'),
            sha256: createHash('sha256').update(fixture).digest('hex'),
          });
        }
      }
    },
  );

  test.each([
    ['65534', 'FAIL_UID'],
    ['10001', 'FAIL_UID'],
    ['65534', 'REJECT_UID'],
    ['10001', 'REJECT_UID'],
  ] as const)(
    'native document gate fails if session user %s fails through %s',
    (uid, failure) => {
      const result = runDocumentGate('arm64', { [failure]: uid });
      expect(result.status, result.stderr + result.stdout).toBe(1);
      for (const checkedUid of ['65534', '10001']) {
        expect(result.stdout).toContain(`Document tools as uid ${checkedUid}`);
        if (failure === 'REJECT_UID' && checkedUid === uid)
          expect(result.stderr).toContain(`Rejected document uid ${uid}`);
        else expect(result.stdout).toContain(`CHECK ${checkedUid} `);
      }
      expect(result.finishedUids).toEqual(['65534', '10001']);
    },
  );

  test.each([
    ['DOCUMENT_IMAGE', 'ghcr.io/synthetic/tale/tale-sandbox-runtime:latest'],
    ['DOCUMENT_PLATFORM', 'linux/unknown'],
    ['PULL_EXIT', '93'],
    ['INSPECT_EXIT', '94'],
    ['TEST_DOCUMENT_LABELS', 'invalid-json'],
    ['ACTUAL_REVISION', 'c'.repeat(40)],
    ['ACTUAL_VERSION', '0.5.43'],
    ['ACTUAL_SOURCE', 'https://github.com/another/tale'],
  ])('native document gate refuses unverified %s=%s', (key, value) => {
    const result = runDocumentGate('amd64', { [key]: value });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('CHECK ');
    expect(result.stdout).not.toContain('Document tools as uid');
    expect(result.startedUids).toEqual([]);
    expect(result.finishedUids).toEqual([]);
  });

  test('release dispatch pins the CLI workflow to the same release tag', () => {
    const step = release.jobs['trigger-cli']!.steps.find(
      (entry) => entry.name === 'Dispatch CLI workflow',
    )!;
    const result = shell('gh() { printf "%s\\n" "$@"; };\n' + step.run, {
      REPO: 'synthetic/tale',
      RELEASE_TAG: 'v0.5.42',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual([
      'workflow',
      'run',
      'cli.yml',
      '--repo',
      'synthetic/tale',
      '--ref',
      'v0.5.42',
      '--field',
      'release_tag=v0.5.42',
    ]);
    expect(step.env?.RELEASE_TAG).toBe('${{ needs.prepare.outputs.version }}');
    expect(step.env?.REPO).toBe('${{ github.repository }}');
  });

  test('manual CLI release builds check out the supplied tag, never moving main', () => {
    const checkout = cli.jobs.build!.steps.find((step) =>
      step.uses?.startsWith('actions/checkout@'),
    )!;
    expect(checkout.with?.ref).toBe(
      '${{ needs.candidate-source.outputs.candidate_sha || needs.prepare.outputs.source_sha || github.sha }}',
    );
  });

  /** `Resolve version` reads the runner's own GITHUB_REF and GITHUB_SHA
   * beside its mapped inputs, and `shell` passes each case its caller's
   * environment: inside a tag publication's runner, that runner's ref refused
   * the valid tags below (#3970). So every case names its whole dispatch, and
   * must decide alike in its caller's environment and inside a synthetic
   * publication runner for another tag at another commit. */
  const PUBLICATION_RUNNER = {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/tags/v0.5.64',
    GITHUB_REF_NAME: 'v0.5.64',
    GITHUB_REF_TYPE: 'tag',
    GITHUB_SHA: 'd'.repeat(40),
  };
  /** A manual recovery dispatched from a branch runs at the branch head. */
  const BRANCH_HEAD = 'c'.repeat(40);
  const resolveCliRelease = (dispatch: {
    RELEASE_TAG: string;
    GITHUB_REF: string;
    GITHUB_SHA: string;
    TEST_TAG_SOURCE?: string;
  }) => {
    const step = cli.jobs.prepare!.steps.find(
      (entry) => entry.id === 'version',
    )!;
    const runners: Record<string, Record<string, string>> = {
      caller: {},
      publication: PUBLICATION_RUNNER,
    };
    return Object.entries(runners).map(([runner, inherited]) => {
      const directory = mkdtempSync(resolve(tmpdir(), 'tale-cli-release-'));
      const output = resolve(directory, 'output');
      try {
        const result = shell(
          `gh() { printf '%s\\n' "$TEST_TAG_SOURCE"; };\n` + step.run!,
          {
            ...inherited,
            TEST_TAG_SOURCE: CI_SOURCE,
            REPOSITORY: 'synthetic/tale',
            EVENT_NAME: 'workflow_dispatch',
            ...dispatch,
            GITHUB_OUTPUT: output,
          },
        );
        return {
          status: result.status,
          output: existsSync(output) ? readFileSync(output, 'utf8') : '',
          log: `${runner} runner, ${dispatch.GITHUB_REF}: ${result.stdout}${result.stderr}`,
        };
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  };

  test.each([
    ['v0.5.42', 0, '0.5.42'],
    ['0.5.42', 0, '0.5.42'],
    ['v0.5.42-rc.1', 0, '0.5.42-rc.1'],
    ['', 1, ''],
    ['main', 1, ''],
    ['v0.5.42; false', 1, ''],
  ])(
    'CLI release tag %j is validated before the build',
    (tag, status, version) => {
      // A dispatch from a branch builds the tag's commit, not the branch
      // head; a dispatch from the tag runs at that commit.
      for (const [ref, sha] of [
        ['refs/heads/main', BRANCH_HEAD],
        [`refs/tags/${tag}`, CI_SOURCE],
      ] as const) {
        for (const result of resolveCliRelease({
          RELEASE_TAG: String(tag),
          GITHUB_REF: ref,
          GITHUB_SHA: sha,
        })) {
          expect(result.status, result.log).toBe(status);
          if (status === 0) {
            expect(result.output).toBe(
              `version=${version}\nsource_sha=${CI_SOURCE}\n`,
            );
          } else {
            expect(result.log).toContain(
              '::error::Release tag must be an exact semantic version',
            );
            expect(result.output).toBe('');
          }
        }
      }
    },
  );

  // Each dispatch runs at CI_SOURCE; the third column is the commit v0.5.42
  // resolves to now.
  test.each([
    [
      'another tag',
      'refs/tags/v0.5.41',
      CI_SOURCE,
      'The dispatch tag must match release_tag exactly',
    ],
    [
      'its version under another tag name',
      'refs/tags/0.5.42',
      CI_SOURCE,
      'The dispatch tag must match release_tag exactly',
    ],
    [
      'its tag, since moved to another commit',
      'refs/tags/v0.5.42',
      'e'.repeat(40),
      'The release tag no longer matches the dispatched commit',
    ],
  ])(
    'CLI release v0.5.42 dispatched on %s is refused before the build',
    (_, ref, source, error) => {
      for (const result of resolveCliRelease({
        RELEASE_TAG: 'v0.5.42',
        GITHUB_REF: ref,
        GITHUB_SHA: CI_SOURCE,
        TEST_TAG_SOURCE: source,
      })) {
        expect(result.status, result.log).toBe(1);
        expect(result.log).toContain(`::error::${error}`);
        expect(result.output).toBe('');
      }
    },
  );
});

describe('database fast-shutdown parity (SIGINT)', () => {
  // The tale-db runtime stage is `FROM scratch`, which drops the upstream
  // postgres image's STOPSIGNAL; without it Docker's SIGTERM is Postgres'
  // *smart* shutdown, which waits for every client session and gets SIGKILLed
  // after the grace period whenever a host-side client holds a connection.
  // That crash-mode stop left a never-initialised page in pg_search's BM25
  // index (PANIC on every knowledge insert). All three definition sites must
  // agree on SIGINT — the *fast* shutdown that disconnects clients,
  // checkpoints, and exits cleanly.
  test('the tale-db image declares STOPSIGNAL SIGINT', () => {
    const dockerfile = readFileSync(
      resolve(repoRoot, 'services/db/Dockerfile'),
      'utf8',
    );
    expect(dockerfile).toMatch(/^STOPSIGNAL SIGINT$/m);
  });

  test('compose.yml stops both Postgres services with SIGINT', () => {
    expect(compose.services.db?.stop_signal).toBe('SIGINT');
    expect(compose.services['knowledge-db']?.stop_signal).toBe('SIGINT');
  });

  test('CLI generator stops the db with SIGINT', () => {
    expect(createDbService(config).stop_signal).toBe('SIGINT');
  });
});

describe('external TLS terminator trust (proxy)', () => {
  // In `external` mode the browser's scheme reaches the proxy only as the
  // terminator's X-Forwarded-Proto. A lane pinning `{scheme}`, or a proxy that
  // trusts no peer, forwarded `http` for every request — so no additional
  // https origin ever matched, and the SPA's SITE_URL, the SSO doors, the
  // OpenAPI servers and the backend's public origin fell back to SITE_URL.
  const caddyfile = readFileSync(
    resolve(repoRoot, 'services/proxy/Caddyfile'),
    'utf8',
  ).replaceAll('\r\n', '\n');
  const entrypoint = readFileSync(
    resolve(repoRoot, 'services/proxy/docker-entrypoint.sh'),
    'utf8',
  ).replaceAll('\r\n', '\n');
  const placeholder = '# TRUSTED_PROXIES_PLACEHOLDER';

  /** The entrypoint's trust block, exactly as the container runs it. */
  function trustBlock(): string {
    const begin = entrypoint.indexOf('\n# BEGIN trusted-proxies\n');
    const end = entrypoint.indexOf('\n# END trusted-proxies\n');
    expect(begin).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);
    return entrypoint.slice(begin, end);
  }

  test('no lane pins X-Forwarded-Proto to the connection scheme', () => {
    expect(caddyfile).not.toMatch(/header_up\s+X-Forwarded-Proto/i);
    expect(entrypoint).not.toMatch(/header_up\s+X-Forwarded-Proto/i);
  });

  test('the trust placeholder sits once, inside the global servers block', () => {
    const lines = caddyfile.split('\n');
    const at = lines.flatMap((line, index) =>
      line.trim() === placeholder ? [index] : [],
    );
    const open = lines.findIndex((line) => line.trim() === 'servers {');
    const close = lines.findIndex(
      (line, index) => index > open && line === '\t}',
    );
    const firstSite = lines.findIndex((line) => line.startsWith('{$'));
    expect(at).toHaveLength(1);
    expect(open).toBeGreaterThan(0);
    expect(at[0]).toBeGreaterThan(open);
    expect(at[0]).toBeLessThan(close);
    expect(close).toBeLessThan(firstSite);
  });

  test('the entrypoint injects trust only inside its external branch', () => {
    const block = trustBlock();
    const external = block.indexOf(
      'if [ "${TLS_MODE:-selfsigned}" = "external" ]; then',
    );
    const otherwise = block.indexOf('\nelse\n');
    const injected = block.indexOf('trusted_proxies static');
    expect(external).toBeGreaterThan(-1);
    expect(injected).toBeGreaterThan(external);
    expect(injected).toBeLessThan(otherwise);
    expect(entrypoint.split('trusted_proxies static')).toHaveLength(2);
  });

  // The entrypoint runs only in the Linux image; render it with POSIX tools.
  describe.skipIf(process.platform === 'win32')('rendered', () => {
    function render(env: Record<string, string>) {
      const directory = mkdtempSync(resolve(tmpdir(), 'tale-proxy-trust-'));
      const file = resolve(directory, 'Caddyfile');
      try {
        writeFileSync(file, caddyfile);
        const result = spawnSync('sh', ['-c', `set -e\n${trustBlock()}`], {
          encoding: 'utf8',
          env: { PATH: process.env.PATH ?? '', CADDYFILE: file, ...env },
        });
        return {
          status: result.status,
          stderr: result.stderr,
          lines: readFileSync(file, 'utf8').split('\n'),
        };
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }

    test.each(['', 'selfsigned', 'letsencrypt'])(
      'TLS_MODE=%p terminates TLS in the proxy and trusts no peer',
      (mode) => {
        const { status, lines } = render({
          TLS_MODE: mode,
          TRUSTED_PROXIES: '10.0.0.0/8',
        });
        expect(status).toBe(0);
        expect(lines.join('\n')).not.toContain('TRUSTED_PROXIES_PLACEHOLDER');
        expect(lines.some((line) => /^\s*trusted_proxies/.test(line))).toBe(
          false,
        );
        expect(lines).toHaveLength(caddyfile.split('\n').length - 1);
      },
    );

    test('external trusts every private range by default, strictly', () => {
      const { status, lines } = render({ TLS_MODE: 'external' });
      expect(status).toBe(0);
      const at = lines.indexOf('\t\ttrusted_proxies static private_ranges');
      expect(at).toBeGreaterThan(
        lines.findIndex((line) => line.trim() === 'servers {'),
      );
      expect(lines[at + 1]).toBe('\t\ttrusted_proxies_strict');
      expect(lines.join('\n')).not.toContain('TRUSTED_PROXIES_PLACEHOLDER');
      expect(lines).toHaveLength(caddyfile.split('\n').length + 1);
    });

    test('external narrows trust to the declared ranges, in order', () => {
      const { status, lines } = render({
        TLS_MODE: 'external',
        TRUSTED_PROXIES: ' 10.147.17.0/24\tfd00::/8  private_ranges\n',
      });
      expect(status).toBe(0);
      expect(lines).toContain(
        '\t\ttrusted_proxies static 10.147.17.0/24 fd00::/8 private_ranges',
      );
    });

    test('external treats a blank value as unset', () => {
      const { status, lines } = render({
        TLS_MODE: 'external',
        TRUSTED_PROXIES: ' \t ',
      });
      expect(status).toBe(0);
      expect(lines).toContain('\t\ttrusted_proxies static private_ranges');
    });

    test.each([
      '*',
      'tale.example.com',
      '10.0.0.1',
      '10.0.0.0/33',
      '256.1.1.0/24',
      '10.0.0.0/8,fd00::/8',
      'private_ranges}',
      '10.0.0.0/8 import evil',
    ])(
      'external refuses TRUSTED_PROXIES=%p before touching the Caddyfile',
      (value) => {
        const { status, stderr, lines } = render({
          TLS_MODE: 'external',
          TRUSTED_PROXIES: value,
        });
        expect(status).not.toBe(0);
        expect(stderr).toContain('TRUSTED_PROXIES entry');
        expect(lines).toContain(`\t\t${placeholder}`);
      },
    );
  });
});
