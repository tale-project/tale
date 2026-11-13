import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type OciRegistryFixture,
  sha256Digest,
  startOciRegistry,
} from '../../../tests/fixtures/oci-registry';
import { CliError, ExitCode } from '../../utils/fail';
import {
  createRegistryClient,
  ImageNotFoundError,
  ociCacheDirectory,
  parseImageReference,
  registryOrigin,
} from './registry';

const DIGEST = `sha256:${'a'.repeat(64)}`;

async function refusal(pending: Promise<unknown>): Promise<CliError> {
  try {
    await pending;
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    if (error instanceof CliError) return error;
  }
  throw new Error('expected a refusal');
}

describe('parseImageReference', () => {
  test.each([
    ['alpine', 'docker.io', 'library/alpine', 'latest', null],
    ['alpine:3.22', 'docker.io', 'library/alpine', '3.22', null],
    ['docker.io/alpine', 'docker.io', 'library/alpine', 'latest', null],
    [
      'index.docker.io/library/alpine:3',
      'docker.io',
      'library/alpine',
      '3',
      null,
    ],
    [
      'brainicism/bgutil-ytdlp-pot-provider:1.3.1',
      'docker.io',
      'brainicism/bgutil-ytdlp-pot-provider',
      '1.3.1',
      null,
    ],
    [
      'ghcr.io/tale-project/tale/tale-proxy:0.5.105',
      'ghcr.io',
      'tale-project/tale/tale-proxy',
      '0.5.105',
      null,
    ],
    ['localhost:5000/team/app', 'localhost:5000', 'team/app', 'latest', null],
    ['localhost/app:1', 'localhost', 'app', '1', null],
    ['[::1]:5000/app:1', '[::1]:5000', 'app', '1', null],
    ['Registry/app', 'Registry', 'app', 'latest', null],
    [`ghcr.io/a/b:1@${DIGEST}`, 'ghcr.io', 'a/b', '1', DIGEST],
    [`ghcr.io/a/b@${DIGEST}`, 'ghcr.io', 'a/b', null, DIGEST],
  ])('%s', (text, registry, repository, tag, digest) => {
    expect(parseImageReference(text)).toEqual({
      registry,
      repository,
      tag,
      digest,
    });
  });

  test.each([
    ['an empty reference', '', /1 to 512 characters/],
    ['a reference over 512 characters', 'a'.repeat(600), /1 to 512 characters/],
    ['an empty tag', 'app:', /tag is malformed/],
    ['a short digest', 'app@sha256:abc', /digest is malformed/],
    [
      'a sha512 digest',
      `app@sha512:${'b'.repeat(128)}`,
      /only a sha256 digest/,
    ],
    ['an upper-case path', 'ghcr.io/Team/app', /repository name is malformed/],
    ['a URL', 'https://ghcr.io/team/app', /registry host is malformed/],
    ['an empty path component', 'ghcr.io//app', /repository name is malformed/],
    [
      'an underscore host',
      'bad_host.example/app',
      /registry host is malformed/,
    ],
    [
      'a name over 255 characters',
      `ghcr.io/${'a'.repeat(250)}`,
      /repository name is malformed/,
    ],
  ])('refuses %s', (_case, text, reason) => {
    expect(() => parseImageReference(text)).toThrow(reason);
  });
});

describe('registryOrigin', () => {
  test('sends docker.io to its API host, or to the mirror in its place', () => {
    expect(registryOrigin('docker.io')).toBe('https://registry-1.docker.io');
    expect(
      registryOrigin('docker.io', { registryMirror: 'mirror.gcr.io' }),
    ).toBe('https://mirror.gcr.io');
    expect(registryOrigin('ghcr.io', { registryMirror: 'mirror.gcr.io' })).toBe(
      'https://ghcr.io',
    );
  });

  test('sends another registry to the mirror declared for it alone', () => {
    const mirrors = {
      registryMirror: 'mirror.gcr.io',
      registryMirrors: { 'ghcr.io': '127.0.0.1:5000' },
    };
    expect(registryOrigin('ghcr.io', mirrors)).toBe('http://127.0.0.1:5000');
    expect(registryOrigin('docker.io', mirrors)).toBe('https://mirror.gcr.io');
    expect(registryOrigin('quay.io', mirrors)).toBe('https://quay.io');
  });

  test('speaks plain HTTP to loopback only', () => {
    expect(registryOrigin('127.0.0.1:5000')).toBe('http://127.0.0.1:5000');
    expect(registryOrigin('localhost:5000')).toBe('http://localhost:5000');
    expect(registryOrigin('[::1]:5000')).toBe('http://[::1]:5000');
    expect(registryOrigin('registry.example:5000')).toBe(
      'https://registry.example:5000',
    );
  });

  test('a mirror is a host, never a URL', () => {
    expect(() =>
      createRegistryClient({ registryMirror: 'https://mirror.gcr.io' }),
    ).toThrow(/must be a host/);
    expect(() =>
      createRegistryClient({
        registryMirrors: { 'ghcr.io': 'http://127.0.0.1:5000' },
      }),
    ).toThrow(/must be a host/);
  });
});

describe('createRegistryClient against a fixture registry', () => {
  let registry: OciRegistryFixture;
  let root: string;

  beforeEach(() => {
    registry = startOciRegistry();
    root = mkdtempSync(join(tmpdir(), 'tale-oci-'));
  });
  afterEach(() => {
    registry.stop();
    rmSync(root, { recursive: true, force: true });
  });

  const twoPlatforms = () =>
    registry.publish('tale/proxy', '1.0', [
      { os: 'linux', architecture: 'amd64' },
      { os: 'linux', architecture: 'arm64' },
    ]);
  const registryRequests = () =>
    registry.requests.filter((request) => request.server === 'registry');

  test('resolves a tag to its index, the platform manifest and its config', async () => {
    const image = twoPlatforms();
    const resolved = await createRegistryClient().resolve(
      `${registry.host}/tale/proxy:1.0`,
      'linux/arm64',
    );
    expect(resolved).toEqual({
      reference: `${registry.host}/tale/proxy@${image.digest}`,
      digest: image.digest,
      manifestDigest: image.manifests['linux/arm64'],
      configDigest: image.configs['linux/arm64'],
      os: 'linux',
      architecture: 'arm64',
      variant: null,
      config: {
        architecture: 'arm64',
        os: 'linux',
        config: {},
        rootfs: { type: 'layers', diff_ids: [] },
      },
    });
  });

  test('answers the bearer challenge anonymously, once per repository', async () => {
    twoPlatforms();
    const client = createRegistryClient();
    await client.resolve(`${registry.host}/tale/proxy:1.0`, 'linux/amd64');
    await client.resolve(`${registry.host}/tale/proxy:1.0`, 'linux/arm64');
    const tokens = registryRequests().filter((r) => r.path === '/token');
    expect(tokens).toEqual([
      { server: 'registry', path: '/token', authorization: null },
    ]);
    // The first ask is challenged; everything after carries the token.
    expect(registryRequests()[0].authorization).toBeNull();
    expect(
      registryRequests()
        .slice(2)
        .every((r) => r.authorization === 'Bearer fixture-token-1'),
    ).toBe(true);
  });

  test('refuses a config blob whose bytes do not match its digest', async () => {
    const image = twoPlatforms();
    // Same length, so only the digest can tell: the config claims arm64.
    registry.tamper(image.configs['linux/amd64'], (published) =>
      published.replace('"amd64"', '"arm64"'),
    );
    const error = await refusal(
      createRegistryClient().resolve(
        `${registry.host}/tale/proxy:1.0`,
        'linux/amd64',
      ),
    );
    expect(error.message).toContain(
      `do not match ${image.configs['linux/amd64']}`,
    );
    expect(error.info.code).toBe(ExitCode.ExternalDep);
  });

  test('refuses a platform manifest whose bytes do not match its digest', async () => {
    const image = twoPlatforms();
    // Same length: the amd64 manifest names the arm64 config.
    registry.tamper(image.manifests['linux/amd64'], (published) =>
      published.replace(
        image.configs['linux/amd64'],
        image.configs['linux/arm64'],
      ),
    );
    const error = await refusal(
      createRegistryClient().resolve(
        `${registry.host}/tale/proxy:1.0`,
        'linux/amd64',
      ),
    );
    expect(error.message).toContain(
      `do not match ${image.manifests['linux/amd64']}`,
    );
  });

  test('refuses a tag whose bytes disagree with the digest the registry announces', async () => {
    const image = twoPlatforms();
    registry.tamper(image.digest, '{"schemaVersion":2,"manifests":[]}');
    const error = await refusal(
      createRegistryClient().resolve(
        `${registry.host}/tale/proxy:1.0`,
        'linux/amd64',
      ),
    );
    expect(error.message).toContain(`do not match ${image.digest}`);
  });

  test('refuses a pinned digest whose bytes do not match it', async () => {
    const image = twoPlatforms();
    registry.tamper(image.digest, '{"schemaVersion":2,"manifests":[]}');
    const error = await refusal(
      createRegistryClient().resolve(
        `${registry.host}/tale/proxy@${image.digest}`,
        'linux/amd64',
      ),
    );
    expect(error.message).toContain(`do not match ${image.digest}`);
  });

  test('refuses a manifest larger than a registry may serve', async () => {
    const image = twoPlatforms();
    registry.tamper(image.digest, ' '.repeat(5 * 1024 * 1024));
    const error = await refusal(
      createRegistryClient().resolve(
        `${registry.host}/tale/proxy:1.0`,
        'linux/amd64',
      ),
    );
    expect(error.message).toContain('larger than the 4194304 bytes');
  });

  test('refuses a platform the index lacks, naming the ones it has', async () => {
    registry.publish('tale/db', '1.0', [
      { os: 'linux', architecture: 'amd64' },
    ]);
    const error = await refusal(
      createRegistryClient().resolve(
        `${registry.host}/tale/db:1.0`,
        'linux/arm64',
      ),
    );
    expect(error.message).toBe(
      `Image ${registry.host}/tale/db:1.0 has no linux/arm64 image; it has linux/amd64.`,
    );
    // Not found, as `docker pull` reports "no matching manifest".
    expect(error).toBeInstanceOf(ImageNotFoundError);
    expect(error.info.code).toBe(ExitCode.Precondition);
  });

  test('reads a single-platform manifest and refuses another platform', async () => {
    const image = registry.publish(
      'tale/minio',
      '1.0',
      [{ os: 'linux', architecture: 'amd64' }],
      { single: true },
    );
    const client = createRegistryClient();
    const resolved = await client.resolve(
      `${registry.host}/tale/minio:1.0`,
      'linux/amd64',
    );
    expect(resolved.digest).toBe(image.digest);
    expect(resolved.manifestDigest).toBe(image.digest);
    expect(resolved.configDigest).toBe(image.configs['linux/amd64']);
    const error = await refusal(
      client.resolve(`${registry.host}/tale/minio:1.0`, 'linux/arm64'),
    );
    expect(error.message).toContain(
      'has no linux/arm64 image; it has linux/amd64',
    );
  });

  test('reads Docker distribution media types', async () => {
    const image = registry.publish(
      'tale/bgutil',
      '1.0',
      [
        { os: 'linux', architecture: 'amd64' },
        { os: 'linux', architecture: 'arm64' },
      ],
      { docker: true },
    );
    const resolved = await createRegistryClient().resolve(
      `${registry.host}/tale/bgutil:1.0`,
      'linux/amd64',
    );
    expect(resolved.manifestDigest).toBe(image.manifests['linux/amd64']);
  });

  test('takes a variant the architecture implies when the platform names none', async () => {
    const image = registry.publish('tale/arm', '1.0', [
      { os: 'linux', architecture: 'arm64', variant: 'v8' },
      { os: 'linux', architecture: 'arm', variant: 'v6' },
      { os: 'linux', architecture: 'arm', variant: 'v7' },
    ]);
    const client = createRegistryClient();
    const reference = `${registry.host}/tale/arm:1.0`;
    expect(
      (await client.resolve(reference, 'linux/arm64')).manifestDigest,
    ).toBe(image.manifests['linux/arm64/v8']);
    expect((await client.resolve(reference, 'linux/arm')).manifestDigest).toBe(
      image.manifests['linux/arm/v7'],
    );
    expect(
      (await client.resolve(reference, 'linux/arm/v6')).manifestDigest,
    ).toBe(image.manifests['linux/arm/v6']);
  });

  test('never carries the token to a blob redirected to another origin', async () => {
    const image = twoPlatforms();
    registry.redirectBlobs = registry.blobStore;
    const resolved = await createRegistryClient().resolve(
      `${registry.host}/tale/proxy:1.0`,
      'linux/amd64',
    );
    expect(resolved.configDigest).toBe(image.configs['linux/amd64']);
    const blob = `/v2/tale/proxy/blobs/${image.configs['linux/amd64']}`;
    expect(
      registry.requests.findLast((r) => r.path === blob)?.authorization,
    ).toBe('Bearer fixture-token-1');
    expect(registry.requests.filter((r) => r.server === 'blob-store')).toEqual([
      {
        server: 'blob-store',
        path: `/blobs/${image.configs['linux/amd64']}`,
        authorization: null,
      },
    ]);
  });

  test('never follows a redirect to plain HTTP off loopback', async () => {
    twoPlatforms();
    registry.redirectBlobs = 'http://blobs.example.invalid';
    const error = await refusal(
      createRegistryClient().resolve(
        `${registry.host}/tale/proxy:1.0`,
        'linux/amd64',
      ),
    );
    expect(error.message).toContain('redirected to plain HTTP');
  });

  test('reports a missing tag as ImageNotFoundError', async () => {
    twoPlatforms();
    const error = await refusal(
      createRegistryClient().resolve(
        `${registry.host}/tale/proxy:9.9`,
        'linux/amd64',
      ),
    );
    expect(error).toBeInstanceOf(ImageNotFoundError);
    expect(error.info.code).toBe(ExitCode.Precondition);
  });

  test('reports a missing pinned digest as not found, and a missing part as a registry failure', async () => {
    const image = twoPlatforms();
    const client = createRegistryClient();
    const pinned = `${registry.host}/tale/proxy@${sha256Digest('gone')}`;
    expect(await refusal(client.resolve(pinned, 'linux/amd64'))).toBeInstanceOf(
      ImageNotFoundError,
    );
    registry.forget(image.configs['linux/amd64']);
    const error = await refusal(
      client.resolve(`${registry.host}/tale/proxy:1.0`, 'linux/amd64'),
    );
    expect(error).not.toBeInstanceOf(ImageNotFoundError);
    expect(error.message).toBe(
      `The registry lacks ${image.configs['linux/amd64']} of image ${registry.host}/tale/proxy:1.0.`,
    );
    expect(error.info.code).toBe(ExitCode.ExternalDep);
  });

  test('refuses a repository the token service denies, as GHCR does a missing or private one', async () => {
    twoPlatforms();
    const error = await refusal(
      createRegistryClient().resolve(
        `${registry.host}/tale/private:1.0`,
        'linux/amd64',
      ),
    );
    expect(error).not.toBeInstanceOf(ImageNotFoundError);
    expect(error.message).toBe(
      `The registry refused anonymous access to ${registry.host}/tale/private:1.0; the CLI reads public images only.`,
    );
    expect(error.info.code).toBe(ExitCode.Precondition);
  });

  test('refuses a registry that asks for credentials', async () => {
    twoPlatforms();
    registry.challenge = 'Basic realm="fixture"';
    const error = await refusal(
      createRegistryClient().resolve(
        `${registry.host}/tale/proxy:1.0`,
        'linux/amd64',
      ),
    );
    expect(error.message).toContain('the CLI reads public images only');
  });

  test('refuses a token service over plain HTTP off loopback', async () => {
    twoPlatforms();
    registry.challenge =
      'Bearer realm="http://registry.example.invalid/token",service="x"';
    const error = await refusal(
      createRegistryClient().resolve(
        `${registry.host}/tale/proxy:1.0`,
        'linux/amd64',
      ),
    );
    expect(error.message).toContain('not an HTTPS address');
    expect(
      registryRequests().filter((request) => request.path === '/token'),
    ).toEqual([]);
  });

  test('refuses a platform that is not os/architecture', async () => {
    twoPlatforms();
    const error = await refusal(
      createRegistryClient().resolve(
        `${registry.host}/tale/proxy:1.0`,
        'amd64',
      ),
    );
    expect(error.message).toContain('is not os/architecture[/variant]');
    expect(registry.requests).toEqual([]);
  });

  test('reads docker.io through the registry mirror', async () => {
    const image = registry.publish('library/alpine', '3.22', [
      { os: 'linux', architecture: 'amd64' },
    ]);
    const resolved = await createRegistryClient({
      registryMirror: registry.host,
    }).resolve('alpine:3.22', 'linux/amd64');
    expect(resolved.reference).toBe(`docker.io/library/alpine@${image.digest}`);
    expect(
      registryRequests()
        .filter((request) => request.path !== '/token')
        .every((request) => request.path.startsWith('/v2/library/alpine/')),
    ).toBe(true);
  });

  test('reads another registry through the mirror declared for it, keeping its name', async () => {
    const image = registry.publish('tale-project/tale/tale-proxy', '1.0', [
      { os: 'linux', architecture: 'amd64' },
    ]);
    const resolved = await createRegistryClient({
      registryMirrors: { 'ghcr.io': registry.host },
    }).resolve('ghcr.io/tale-project/tale/tale-proxy:1.0', 'linux/amd64');
    expect(resolved.reference).toBe(
      `ghcr.io/tale-project/tale/tale-proxy@${image.digest}`,
    );
    expect(
      registryRequests()
        .filter((request) => request.path !== '/token')
        .every((request) =>
          request.path.startsWith('/v2/tale-project/tale/tale-proxy/'),
        ),
    ).toBe(true);
  });

  describe('the cache under .tale/oci', () => {
    const blob = (digest: string) =>
      join(root, '.tale', 'oci', 'blobs', 'sha256', digest.slice(7));

    test('keeps every verified document by digest and reads a pinned reference offline', async () => {
      const image = twoPlatforms();
      const cacheDirectory = ociCacheDirectory(root);
      expect(cacheDirectory).toBe(join(root, '.tale', 'oci'));
      const first = await createRegistryClient({ cacheDirectory }).resolve(
        `${registry.host}/tale/proxy:1.0`,
        'linux/amd64',
      );
      for (const digest of [
        image.digest,
        image.manifests['linux/amd64'],
        image.configs['linux/amd64'],
      ]) {
        expect(sha256Digest(readFileSync(blob(digest)))).toBe(digest);
        if (process.platform !== 'win32')
          expect(statSync(blob(digest)).mode & 0o777).toBe(0o600);
      }
      const seen = registry.requests.length;
      const pinned = await createRegistryClient({ cacheDirectory }).resolve(
        first.reference,
        'linux/amd64',
      );
      expect(pinned).toEqual(first);
      expect(registry.requests.length).toBe(seen);
    });

    test('asks for a tag every time and follows it when it moves', async () => {
      twoPlatforms();
      const client = createRegistryClient({
        cacheDirectory: ociCacheDirectory(root),
      });
      const reference = `${registry.host}/tale/proxy:1.0`;
      await client.resolve(reference, 'linux/amd64');
      const seen = registry.requests.length;
      await client.resolve(reference, 'linux/amd64');
      // The tag alone: its index, manifest and config come from the cache.
      expect(registry.requests.slice(seen).map((r) => r.path)).toEqual([
        '/v2/tale/proxy/manifests/1.0',
      ]);
      const moved = registry.publish('tale/proxy', '1.0', [
        {
          os: 'linux',
          architecture: 'amd64',
          config: { Labels: { release: 'two' } },
        },
      ]);
      expect((await client.resolve(reference, 'linux/amd64')).digest).toBe(
        moved.digest,
      );
    });

    test('discards an entry that no longer holds its bytes and fetches it again', async () => {
      const image = twoPlatforms();
      const cacheDirectory = ociCacheDirectory(root);
      const first = await createRegistryClient({ cacheDirectory }).resolve(
        `${registry.host}/tale/proxy:1.0`,
        'linux/amd64',
      );
      const config = image.configs['linux/amd64'];
      // Same length, so only the digest can tell: the pinned index (read
      // with no descriptor size) and the config (read with one) both swap
      // amd64 for arm64.
      const swapped = (digest: string) =>
        readFileSync(blob(digest), 'utf8').replaceAll('"amd64"', '"arm64"');
      for (const digest of [image.digest, config]) {
        const original = readFileSync(blob(digest));
        writeFileSync(blob(digest), swapped(digest));
        expect(readFileSync(blob(digest)).byteLength).toBe(original.byteLength);
      }
      const seen = registry.requests.length;
      expect(
        await createRegistryClient({ cacheDirectory }).resolve(
          first.reference,
          'linux/amd64',
        ),
      ).toEqual(first);
      for (const digest of [image.digest, config])
        expect(sha256Digest(readFileSync(blob(digest)))).toBe(digest);
      expect(
        registry.requests
          .slice(seen)
          .filter((r) => r.path !== '/token')
          .map((r) => r.path),
      ).toEqual([
        `/v2/tale/proxy/manifests/${image.digest}`,
        `/v2/tale/proxy/manifests/${image.digest}`,
        `/v2/tale/proxy/blobs/${config}`,
      ]);
    });
  });
});
