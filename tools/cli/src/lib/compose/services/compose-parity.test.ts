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
