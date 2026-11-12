import { createHash } from 'node:crypto';

/**
 * A fixture OCI distribution registry on loopback, in the shape GHCR answers
 * (read 2026-11-12): a bearer challenge whose realm hands out anonymous pull
 * tokens per published repository and denies one for any other (403 DENIED,
 * as GHCR answers a missing or private repository), an index per
 * multi-platform tag with buildx's attestation entries,
 * `Docker-Content-Digest` on manifests, and, when asked, blobs redirected to
 * another origin as GHCR does to its blob store. Every request is recorded;
 * any digest can be made to serve other bytes.
 */

const OCI = {
  index: 'application/vnd.oci.image.index.v1+json',
  manifest: 'application/vnd.oci.image.manifest.v1+json',
  config: 'application/vnd.oci.image.config.v1+json',
};
const DOCKER = {
  index: 'application/vnd.docker.distribution.manifest.list.v2+json',
  manifest: 'application/vnd.docker.distribution.manifest.v2+json',
  config: 'application/vnd.docker.container.image.v1+json',
};
const SERVICE = 'fixture-registry';

export const sha256Digest = (bytes: Uint8Array | string): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export interface FixturePlatform {
  os: string;
  architecture: string;
  variant?: string;
  /** The image config's `config` object: Labels, Env, Entrypoint, … */
  config?: Record<string, unknown>;
}

export interface FixtureImage {
  /** What the tag names: the index, or the manifest of a single-platform image. */
  digest: string;
  /** By `os/architecture[/variant]`. */
  manifests: Record<string, string>;
  configs: Record<string, string>;
}

export interface FixtureRequest {
  server: 'registry' | 'blob-store';
  path: string;
  authorization: string | null;
}

export interface OciRegistryFixture {
  /** `127.0.0.1:<port>`, a registry host in a reference. */
  host: string;
  requests: FixtureRequest[];
  /** Redirect every blob to this origin, as GHCR does to its blob store. */
  redirectBlobs: string | null;
  /** A second loopback origin that serves every blob. */
  blobStore: string;
  /** Answer a missing token with this challenge instead of the bearer one. */
  challenge: string | null;
  publish(
    repository: string,
    tag: string,
    platforms: FixturePlatform[],
    options?: { single?: boolean; docker?: boolean },
  ): FixtureImage;
  /**
   * Serve other bytes for `digest` from now on: `bytes`, or what `edit` makes
   * of the published ones (an edit that keeps the length passes a size check).
   */
  tamper(digest: string, bytes: string | ((published: string) => string)): void;
  /** Lose `digest`, as a registry that garbage-collected it. */
  forget(digest: string): void;
  stop(): void;
}

export function startOciRegistry(): OciRegistryFixture {
  const content = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  const tampered = new Map<string, Uint8Array>();
  const tags = new Map<string, string>();
  const repositories = new Set<string>();
  const issued = new Map<string, string>();
  const requests: FixtureRequest[] = [];
  const served = (digest: string) =>
    tampered.get(digest) ?? content.get(digest)?.bytes;

  const blobStore = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push({
        server: 'blob-store',
        path: url.pathname,
        authorization: request.headers.get('authorization'),
      });
      const bytes = served(url.pathname.slice('/blobs/'.length));
      return bytes ? new Response(bytes) : new Response(null, { status: 404 });
    },
  });

  const fixture: OciRegistryFixture = {
    host: '',
    requests,
    redirectBlobs: null,
    blobStore: `http://127.0.0.1:${blobStore.port}`,
    challenge: null,
    publish(repository, tag, platforms, options = {}) {
      repositories.add(repository);
      const types = options.docker ? DOCKER : OCI;
      const put = (value: unknown, mediaType: string) => {
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        const digest = sha256Digest(bytes);
        content.set(digest, { bytes, mediaType });
        return { mediaType, digest, size: bytes.byteLength };
      };
      const manifests: Record<string, string> = {};
      const configs: Record<string, string> = {};
      const entries = platforms.map((platform) => {
        const key = [platform.os, platform.architecture, platform.variant]
          .filter(Boolean)
          .join('/');
        const identity = {
          architecture: platform.architecture,
          os: platform.os,
          ...(platform.variant ? { variant: platform.variant } : {}),
        };
        const config = put(
          {
            ...identity,
            config: platform.config ?? {},
            rootfs: { type: 'layers', diff_ids: [] },
          },
          types.config,
        );
        const manifest = put(
          { schemaVersion: 2, mediaType: types.manifest, config, layers: [] },
          types.manifest,
        );
        manifests[key] = manifest.digest;
        configs[key] = config.digest;
        return { ...manifest, platform: identity };
      });
      if (options.single) {
        tags.set(`${repository}:${tag}`, entries[0].digest);
        return { digest: entries[0].digest, manifests, configs };
      }
      const attestations = options.docker
        ? []
        : entries.map((entry) => ({
            ...put(
              {
                schemaVersion: 2,
                mediaType: OCI.manifest,
                config: put({}, 'application/vnd.oci.empty.v1+json'),
                layers: [],
              },
              OCI.manifest,
            ),
            platform: { architecture: 'unknown', os: 'unknown' },
            annotations: {
              'vnd.docker.reference.digest': entry.digest,
              'vnd.docker.reference.type': 'attestation-manifest',
            },
          }));
      const index = put(
        {
          schemaVersion: 2,
          mediaType: types.index,
          manifests: [...entries, ...attestations],
        },
        types.index,
      );
      tags.set(`${repository}:${tag}`, index.digest);
      return { digest: index.digest, manifests, configs };
    },
    tamper(digest, bytes) {
      const published = new TextDecoder().decode(content.get(digest)?.bytes);
      tampered.set(
        digest,
        new TextEncoder().encode(
          typeof bytes === 'string' ? bytes : bytes(published),
        ),
      );
    },
    forget(digest) {
      content.delete(digest);
    },
    stop() {
      registry.stop(true);
      blobStore.stop(true);
    },
  };

  const registry = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const authorization = request.headers.get('authorization');
      requests.push({ server: 'registry', path: url.pathname, authorization });
      if (url.pathname === '/token') {
        const scope = url.searchParams.get('scope');
        // Anonymous only: a token request never carries credentials.
        if (
          url.searchParams.get('service') !== SERVICE ||
          !scope ||
          authorization
        )
          return new Response(null, { status: 400 });
        const name = /^repository:(.+):pull$/.exec(scope)?.[1];
        if (name === undefined || !repositories.has(name))
          return Response.json(
            {
              errors: [
                {
                  code: 'DENIED',
                  message: 'requested access to the resource is denied',
                },
              ],
            },
            { status: 403 },
          );
        const token = `fixture-token-${issued.size + 1}`;
        issued.set(token, scope);
        return Response.json({ token });
      }
      const route = /^\/v2\/(.+)\/(manifests|blobs)\/([^/]+)$/.exec(
        url.pathname,
      );
      if (!route) return new Response(null, { status: 404 });
      const [, repository, kind, reference] = route;
      const scope = `repository:${repository}:pull`;
      const token = authorization?.replace(/^Bearer /, '');
      if (!token || issued.get(token) !== scope)
        return Response.json(
          { errors: [{ code: 'UNAUTHORIZED' }] },
          {
            status: 401,
            headers: {
              'WWW-Authenticate':
                fixture.challenge ??
                `Bearer realm="http://${fixture.host}/token",service="${SERVICE}",scope="${scope}"`,
            },
          },
        );
      const digest = reference.startsWith('sha256:')
        ? reference
        : tags.get(`${repository}:${reference}`);
      const stored = digest === undefined ? undefined : content.get(digest);
      if (digest === undefined || stored === undefined)
        return Response.json(
          {
            errors: [
              { code: kind === 'blobs' ? 'BLOB_UNKNOWN' : 'MANIFEST_UNKNOWN' },
            ],
          },
          { status: 404 },
        );
      if (kind === 'blobs' && fixture.redirectBlobs !== null)
        return new Response(null, {
          status: 307,
          headers: { Location: `${fixture.redirectBlobs}/blobs/${digest}` },
        });
      return new Response(served(digest), {
        headers: {
          'Content-Type': stored.mediaType,
          'Docker-Content-Digest': digest,
        },
      });
    },
  });
  fixture.host = `127.0.0.1:${registry.port}`;
  return fixture;
}
