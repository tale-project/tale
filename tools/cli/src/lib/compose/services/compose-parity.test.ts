import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { setProjectId } from '../../project/project-context';
import { generateStatefulCompose } from '../generators/generate-stateful-compose';
import type { ComposeService, ServiceConfig } from '../types';
import {
  ALL_SERVICES,
  THIRD_PARTY_IMAGES,
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
      build?: unknown;
      ports?: unknown[];
      environment?: Record<string, string>;
      healthcheck?: { test?: string[] };
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
    env?: Record<string, string>;
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
    spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
      encoding: 'utf8',
      env: { ...process.env, SKIP_BUILD: '', PULL_POLICY: '', ...env },
    });

  const prepareImages = (step: Step, services: string[]) => {
    const script = step
      .run!.replaceAll('${{ needs.prepare.outputs.version_number }}', '0.5.43')
      .replaceAll('${{ needs.changes.outputs.image_tag }}', 'ci-proof')
      .replaceAll('${{ env.REGISTRY }}', 'ghcr.io')
      .replaceAll('${{ github.repository }}', 'tale-project/tale');
    // Match the Ubuntu workflow's LF output when Git Bash uses native jq.exe.
    const jqMode =
      process.platform === 'win32'
        ? 'jq() { command jq --binary "$@"; };\n'
        : '';
    const result = shell(
      jqMode +
        'docker() { printf "DOCKER"; printf "\\t%s" "$@"; printf "\\n"; };\n' +
        script,
      { SERVICE_NAMES: JSON.stringify(services) },
    );
    expect(result.status).toBe(0);
    const images = new Map<string, string>();
    for (const line of result.stdout.split('\n')) {
      if (!line.startsWith('DOCKER\t')) continue;
      const [, command, source, target] = line.split('\t');
      expect(source).toBeDefined();
      if (command === 'pull') {
        images.set(source!, source!);
      } else {
        expect(command).toBe('tag');
        expect(images.has(source!)).toBe(true);
        expect(target).toBeDefined();
        images.set(target!, images.get(source!)!);
      }
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
      for (const [alias, source] of tested) {
        if (alias.endsWith(':ci-proof')) continue;
        expect(released.get(alias)).toBe(
          source.replace(':ci-proof', ':0.5.43-amd64'),
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

  test('every release container check inspects pulled images without rebuilding', () => {
    const steps = release.jobs['container-test']!.steps.filter((step) =>
      step.run?.includes('bun services/platform/tests/integration/'),
    );
    expect(steps).toHaveLength(5);
    for (const step of steps) {
      const result = shell(
        'bun() { printf "%s\\n" "$SKIP_BUILD" "$PULL_POLICY" "$*"; };\n' +
          step.run,
        step.env,
      );
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual([
        'true',
        'never',
        expect.stringMatching(/^services\/platform\/tests\/integration\//),
      ]);
    }
  });

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
  const runDocumentGate = (
    arch: string,
    overrides: Record<string, string> = {},
  ) =>
    shell(
      String.raw`
        docker() {
          case "$1 $2" in
            'pull --platform')
              test "$3" = "$DOCUMENT_PLATFORM"
              test "$4" = "$DOCUMENT_IMAGE"
              printf 'PULL %s %s\n' "$3" "$4"
              return "$PULL_EXIT"
              ;;
            'image inspect')
              test "$5" = "$DOCUMENT_IMAGE"
              case "$4" in
                *image.revision*) printf '%s\n' "$ACTUAL_REVISION" ;;
                *image.version*) printf '%s\n' "$ACTUAL_VERSION" ;;
                *image.source*) printf '%s\n' "$ACTUAL_SOURCE" ;;
                *) return 90 ;;
              esac
              ;;
            *) return 91 ;;
          esac
        }
        bun() {
          test "$1" = '-e'
          printf 'CHECK %s %s %s\n' "$DOCUMENT_UID" "$DOCUMENT_PLATFORM" "$DOCUMENT_IMAGE"
          if test "$DOCUMENT_UID" = "$FAIL_UID"; then return 92; fi
        }
      ` + documentStep().run,
      {
        DOCUMENT_IMAGE: documentImage(arch),
        DOCUMENT_PLATFORM: `linux/${arch}`,
        DOCUMENT_REVISION: 'b'.repeat(40),
        DOCUMENT_VERSION: '0.5.44',
        DOCUMENT_SOURCE: 'https://github.com/synthetic/tale',
        ACTUAL_REVISION: 'b'.repeat(40),
        ACTUAL_VERSION: '0.5.44',
        ACTUAL_SOURCE: 'https://github.com/synthetic/tale',
        PULL_EXIT: '0',
        FAIL_UID: '',
        ...overrides,
      },
    );

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
    expect(step.run).toContain('if (result.exitCode !== 0)');
    expect(step.run).toContain('throw new Error(result.combined)');
  });

  test.each(['amd64', 'arm64'])(
    'native %s document gate executes both session users against the immutable image',
    (arch) => {
      const result = runDocumentGate(arch);
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual([
        `PULL linux/${arch} ${documentImage(arch)}`,
        `CHECK 65534 linux/${arch} ${documentImage(arch)}`,
        `CHECK 10001 linux/${arch} ${documentImage(arch)}`,
      ]);
    },
  );

  test.each(['65534', '10001'])(
    'native document gate fails if session user %s fails',
    (uid) => {
      const result = runDocumentGate('arm64', { FAIL_UID: uid });
      expect(result.status).toBe(92);
      expect(result.stdout).toContain(`CHECK ${uid} `);
      if (uid === '65534') expect(result.stdout).not.toContain('CHECK 10001 ');
    },
  );

  test.each([
    ['DOCUMENT_IMAGE', 'ghcr.io/synthetic/tale/tale-sandbox-runtime:latest'],
    ['DOCUMENT_PLATFORM', 'linux/unknown'],
    ['PULL_EXIT', '93'],
    ['ACTUAL_REVISION', 'c'.repeat(40)],
    ['ACTUAL_VERSION', '0.5.43'],
    ['ACTUAL_SOURCE', 'https://github.com/another/tale'],
  ])('native document gate refuses unverified %s=%s', (key, value) => {
    const result = runDocumentGate('amd64', { [key]: value });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('CHECK ');
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
      "${{ github.event_name == 'workflow_dispatch' && format('refs/tags/{0}', inputs.release_tag) || github.sha }}",
    );
  });

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
      const step = cli.jobs.prepare!.steps.find(
        (entry) => entry.id === 'version',
      )!;
      const directory = mkdtempSync(resolve(tmpdir(), 'tale-cli-release-'));
      const output = resolve(directory, 'output');
      try {
        const result = shell(step.run!, {
          EVENT_NAME: 'workflow_dispatch',
          RELEASE_TAG: String(tag),
          GITHUB_OUTPUT: output,
        });
        expect(result.status).toBe(status);
        if (status === 0) {
          expect(readFileSync(output, 'utf8')).toBe(`version=${version}\n`);
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
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
