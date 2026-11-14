import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type OciRegistryFixture,
  startOciRegistry,
} from '../../../tests/fixtures/oci-registry';
import { ExitCode } from '../../utils/fail';
import { AUTOMATION_PROTOCOL_LABEL } from '../deployment/automation-model';
import { imageWriterProtocol } from '../deployment/automation-protocol';
import { TALE_REGISTRY } from '../deployment/runtime-model';
import { readImageFacts, TALE_INIT_LABEL } from './image-facts';
import { createRegistryClient, ociCacheDirectory } from './registry';

const REVISION = 'c'.repeat(40);

describe('readImageFacts against a fixture registry', () => {
  let registry: OciRegistryFixture;

  beforeEach(() => {
    registry = startOciRegistry();
  });
  afterEach(() => {
    registry.stop();
  });

  test('reads every fact a runtime other than Docker applies itself', async () => {
    const labels = {
      'org.opencontainers.image.revision': REVISION,
      'org.opencontainers.image.version': '0.6.0',
      [AUTOMATION_PROTOCOL_LABEL]: '2',
      [TALE_INIT_LABEL]: 'dumb-init-1.2.5+maxsig64',
    };
    const image = registry.publish('tale/platform', '0.6.0', [
      {
        os: 'linux',
        architecture: 'amd64',
        config: {
          Entrypoint: ['/usr/local/bin/docker-entrypoint.sh'],
          Cmd: ['caddy', 'run', '--config', '/config/Caddyfile'],
          Env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'TLS_MODE=selfsigned'],
          User: 'caddy',
          WorkingDir: '/srv',
          StopSignal: 'SIGQUIT',
          Volumes: { '/data': {}, '/config': {} },
          ExposedPorts: { '80/tcp': {} },
          Labels: labels,
          Healthcheck: {
            Test: [
              'CMD-SHELL',
              'wget -q --spider http://127.0.0.1:2020/health',
            ],
            Interval: 30_000_000_000,
            Timeout: 10_000_000_000,
            StartPeriod: 10_000_000_000,
            Retries: 3,
          },
        },
      },
      { os: 'linux', architecture: 'arm64' },
    ]);
    const facts = await readImageFacts(
      createRegistryClient(),
      `${registry.host}/tale/platform:0.6.0`,
      'linux/amd64',
    );
    expect(facts).toEqual({
      reference: `${registry.host}/tale/platform@${image.digest}`,
      digest: image.digest,
      manifestDigest: image.manifests['linux/amd64'],
      configDigest: image.configs['linux/amd64'],
      os: 'linux',
      architecture: 'amd64',
      variant: null,
      labels,
      revision: REVISION,
      automationWriterProtocol: '2',
      init: 'dumb-init-1.2.5+maxsig64',
      entrypoint: ['/usr/local/bin/docker-entrypoint.sh'],
      cmd: ['caddy', 'run', '--config', '/config/Caddyfile'],
      env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'TLS_MODE=selfsigned'],
      user: 'caddy',
      workingDir: '/srv',
      stopSignal: 'SIGQUIT',
      healthcheck: {
        test: ['CMD-SHELL', 'wget -q --spider http://127.0.0.1:2020/health'],
        intervalMs: 30_000,
        timeoutMs: 10_000,
        startPeriodMs: 10_000,
        startIntervalMs: null,
        retries: 3,
      },
      volumes: ['/config', '/data'],
    });
    // The writer protocol keeps its one judge.
    expect(imageWriterProtocol(facts.labels)).toBe(2);
  });

  test('reports what an image leaves unset as null or empty', async () => {
    registry.publish('tale/bare', '1', [
      {
        os: 'linux',
        architecture: 'arm64',
        config: {
          User: '',
          WorkingDir: '',
          Labels: null,
          Env: null,
          Volumes: null,
          Healthcheck: { Test: [] },
        },
      },
    ]);
    const facts = await readImageFacts(
      createRegistryClient(),
      `${registry.host}/tale/bare:1`,
      'linux/arm64',
    );
    expect(facts).toMatchObject({
      labels: {},
      revision: null,
      automationWriterProtocol: null,
      init: null,
      entrypoint: null,
      cmd: null,
      env: [],
      user: null,
      workingDir: null,
      stopSignal: null,
      healthcheck: null,
      volumes: [],
    });
  });

  test('keeps a health check the image switches off', async () => {
    registry.publish('tale/quiet', '1', [
      {
        os: 'linux',
        architecture: 'amd64',
        config: { Healthcheck: { Test: ['NONE'] } },
      },
    ]);
    const facts = await readImageFacts(
      createRegistryClient(),
      `${registry.host}/tale/quiet:1`,
      'linux/amd64',
    );
    expect(facts.healthcheck).toEqual({
      test: ['NONE'],
      intervalMs: null,
      timeoutMs: null,
      startPeriodMs: null,
      startIntervalMs: null,
      retries: null,
    });
  });

  test('refuses a config that is no container image config', async () => {
    registry.publish('tale/odd', '1', [
      {
        os: 'linux',
        architecture: 'amd64',
        config: { Labels: { release: 2 } },
      },
    ]);
    let caught: unknown;
    try {
      await readImageFacts(
        createRegistryClient(),
        `${registry.host}/tale/odd:1`,
        'linux/amd64',
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      message: `The image config of ${registry.host}/tale/odd:1 is no container image config.`,
      info: { code: ExitCode.ExternalDep },
    });
  });
});

/**
 * Reads of public images from the real registries, over the network:
 * `TALE_REGISTRY_LIVE=1 bun test src/lib/oci/image-facts.test.ts`.
 */
describe.skipIf(process.env.TALE_REGISTRY_LIVE !== '1')(
  'readImageFacts against the public registries',
  () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'tale-oci-live-'));
    });
    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    test('reads tale-proxy for both platforms of one index', async () => {
      const client = createRegistryClient({
        cacheDirectory: ociCacheDirectory(root),
      });
      const reference = `${TALE_REGISTRY}/tale-proxy:latest`;
      const amd64 = await readImageFacts(client, reference, 'linux/amd64');
      const arm64 = await readImageFacts(client, reference, 'linux/arm64');
      expect(amd64.reference).toMatch(
        /^ghcr\.io\/tale-project\/tale\/tale-proxy@sha256:[a-f0-9]{64}$/,
      );
      expect(arm64.digest).toBe(amd64.digest);
      expect(arm64.manifestDigest).not.toBe(amd64.manifestDigest);
      expect([amd64.architecture, arm64.architecture]).toEqual([
        'amd64',
        'arm64',
      ]);
      expect(amd64.labels['org.opencontainers.image.source']).toBe(
        'https://github.com/tale-project/tale',
      );
      expect(amd64.revision).toMatch(/^[a-f0-9]{40}$/);
      expect(amd64.entrypoint?.length).toBeGreaterThan(0);
      expect(amd64.healthcheck?.test.length).toBeGreaterThan(0);
      expect(amd64.volumes).toContain('/data');
      // Once seen, the pinned index reads from the cache alone.
      expect(
        await readImageFacts(
          createRegistryClient({ cacheDirectory: ociCacheDirectory(root) }),
          amd64.reference,
          'linux/amd64',
        ),
      ).toEqual(amd64);
    }, 60_000);

    test('names the image GHCR will not open to an anonymous reader', async () => {
      // GHCR denies a token for a missing or private repository (403 DENIED).
      const reference = `${TALE_REGISTRY}/tale-missing:latest`;
      let caught: unknown;
      try {
        await readImageFacts(createRegistryClient(), reference, 'linux/amd64');
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        message: `The registry refused anonymous access to ${reference}; the CLI reads public images only.`,
        info: { code: ExitCode.Precondition },
      });
    }, 60_000);

    test('reads the stack’s docker.io image through mirror.gcr.io', async () => {
      // The bgutil-provider pin (compose/services/create-bgutil-provider-service.ts).
      const facts = await readImageFacts(
        createRegistryClient({ registryMirror: 'mirror.gcr.io' }),
        'brainicism/bgutil-ytdlp-pot-provider:1.3.1',
        'linux/amd64',
      );
      expect(facts.reference).toMatch(
        /^docker\.io\/brainicism\/bgutil-ytdlp-pot-provider@sha256:[a-f0-9]{64}$/,
      );
      expect([facts.os, facts.architecture]).toEqual(['linux', 'amd64']);
    }, 60_000);
  },
);
