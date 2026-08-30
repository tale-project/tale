import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { setProjectId } from '../../project/project-context';
import { generateStatefulCompose } from '../generators/generate-stateful-compose';
import type { ServiceConfig } from '../types';
import {
  createBackendApiService,
  createBackendWorkerService,
} from './create-backend-services';
import { createObjectStorageService } from './create-object-storage-service';

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
      stop_grace_period?: string;
      image?: string;
      build?: unknown;
      ports?: unknown[];
      environment?: Record<string, string>;
    }
  >;
};

function networkNames(networks: unknown): string[] {
  if (Array.isArray(networks)) return networks as string[];
  if (networks && typeof networks === 'object') return Object.keys(networks);
  return [];
}

function graceSeconds(value: string | undefined): number {
  if (!value) return 0;
  const match = /^(\d+)s$/.exec(value);
  return match ? Number(match[1]) : 0;
}

describe('sandbox→backend reachability parity', () => {
  test('CLI generator dual-homes the api onto the sandbox net with its alias', () => {
    const networks = createBackendApiService(config).networks;
    if (Array.isArray(networks) || networks === undefined) {
      throw new Error('api networks should be the object form with aliases');
    }
    expect(networks.internal).toBeDefined();
    expect(networks.sandbox).toBeDefined();
    // container_name is `<project>-backend-api`, so the explicit alias is what
    // makes http://backend-api:3005 resolve from a session container.
    expect(networks.sandbox?.aliases).toContain('backend-api');
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
