import { createHash, randomUUID } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import {
  CliError,
  ExitCode,
  externalDepError,
  preconditionError,
} from '../../utils/fail';
import * as logger from '../../utils/logger';

/**
 * A Docker-free reader of an image, straight from its OCI distribution
 * registry: tag → index → the platform's manifest → config blob. Every byte is
 * checked against the sha256 digest that names it before it is parsed, so a
 * registry, a mirror or the cache can withhold an image but never change one.
 *
 * Pulls are anonymous: a registry's bearer challenge is answered with an
 * anonymous token for `repository:<name>:pull`, and every image the stack
 * runs is public. Verified manifests and configs are kept by digest under
 * `.tale/oci/`, so a digest-pinned reference reads offline once seen; a tag is
 * always asked again, because a tag moves.
 */

const DOCKER_HUB = 'docker.io';
const DOCKER_HUB_API = 'registry-1.docker.io';
const LEGACY_DOCKER_HUB = 'index.docker.io';
/** The distribution spec has clients expect manifests of at least 4 MB. */
const MANIFEST_LIMIT = 4 * 1024 * 1024;
const CONFIG_LIMIT = 8 * 1024 * 1024;
const TOKEN_LIMIT = 64 * 1024;
const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 30_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const OCI_INDEX = 'application/vnd.oci.image.index.v1+json';
const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json';
const DOCKER_INDEX =
  'application/vnd.docker.distribution.manifest.list.v2+json';
const DOCKER_MANIFEST = 'application/vnd.docker.distribution.manifest.v2+json';
const INDEX_TYPES = new Set([OCI_INDEX, DOCKER_INDEX]);
const MANIFEST_TYPES = new Set([OCI_MANIFEST, DOCKER_MANIFEST]);
const CONFIG_TYPES = new Set([
  'application/vnd.oci.image.config.v1+json',
  'application/vnd.docker.container.image.v1+json',
]);
const ACCEPT = [OCI_INDEX, OCI_MANIFEST, DOCKER_INDEX, DOCKER_MANIFEST].join(
  ', ',
);

// The reference grammar of github.com/distribution/reference (regexp.go,
// normalize.go), which Docker and containerd parse with.
const ALPHANUMERIC = '[a-z0-9]+';
const SEPARATOR = '(?:[._]|__|[-]+)';
const PATH_COMPONENT = `${ALPHANUMERIC}(?:${SEPARATOR}${ALPHANUMERIC})*`;
const REMOTE_NAME = new RegExp(`^${PATH_COMPONENT}(?:/${PATH_COMPONENT})*$`);
const DOMAIN_COMPONENT = '(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9])';
const DOMAIN = new RegExp(
  `^(?:${DOMAIN_COMPONENT}(?:\\.${DOMAIN_COMPONENT})*|\\[[a-fA-F0-9:]+\\])(?::[0-9]+)?$`,
);
const TAG = /^\w[\w.-]{0,127}$/;
const DIGEST =
  /^[A-Za-z][A-Za-z0-9]*(?:[-_+.][A-Za-z][A-Za-z0-9]*)*:[0-9a-fA-F]{32,}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const NAME_LIMIT = 255;
const PLATFORM = /^([a-z0-9]+)\/([a-z0-9_]+)(?:\/([a-z0-9]+))?$/;
/** The variant an architecture means when it names none (containerd). */
const DEFAULT_VARIANTS: Record<string, string> = { arm64: 'v8', arm: 'v7' };

export interface ImageReference {
  /** Canonical registry name: `docker.io`, `ghcr.io`, `127.0.0.1:5000`. */
  registry: string;
  /** The repository within it: `library/alpine`, `tale-project/tale/tale-proxy`. */
  repository: string;
  /** `latest` when the reference names neither a tag nor a digest. */
  tag: string | null;
  digest: string | null;
}

/** What a reference resolved to, every byte verified. */
export interface ResolvedImage {
  /** `registry/repository@digest`: the bytes a runtime pulls. */
  reference: string;
  /** What the reference names: the index for a multi-platform image. */
  digest: string;
  /** The platform's own manifest; equal to `digest` for a single manifest. */
  manifestDigest: string;
  /** The config blob, which Docker reports as the image ID. */
  configDigest: string;
  os: string;
  architecture: string;
  variant: string | null;
  /** The parsed config blob. */
  config: unknown;
}

export interface RegistryClientOptions {
  /** A host (`mirror.gcr.io`) that serves docker.io's repositories in its place. */
  registryMirror?: string;
  /** Where verified manifests and configs are kept by digest: `ociCacheDirectory(root)`. */
  cacheDirectory?: string;
  /** Bounds each request, its body included (default 30 s). */
  timeoutMs?: number;
}

export interface RegistryClient {
  /** Resolve `reference` for `platform` (`linux/amd64`, `linux/arm64`, `linux/arm/v7`). */
  resolve(reference: string, platform: string): Promise<ResolvedImage>;
}

/**
 * A missing tag, digest or platform: a normal answer for a caller that tries
 * several, as the managed path treats `docker pull`'s "manifest unknown",
 * "not found" and "no matching manifest" alike.
 */
export class ImageNotFoundError extends CliError {
  constructor(summary: string) {
    super({ summary, code: ExitCode.Precondition });
    this.name = 'ImageNotFoundError';
  }
}

const imageNotFound = (display: string): ImageNotFoundError =>
  new ImageNotFoundError(`Image ${display} was not found in its registry.`);

/** A repository the registry will not open to an anonymous reader (GHCR: missing or private). */
const anonymousRefused = (display: string): CliError =>
  preconditionError(
    `The registry refused anonymous access to ${display}; the CLI reads public images only.`,
  );

/** The cache under a workspace or state directory. */
export function ociCacheDirectory(root: string): string {
  return join(root, '.tale', 'oci');
}

/**
 * Parse an image reference the way Docker does: a first component without a
 * dot, a colon or an upper-case letter (and not `localhost`) is a Docker Hub
 * namespace, a single name is under `library/`, and no tag means `latest`.
 * Only sha256 digests are accepted, because only they can be verified.
 */
export function parseImageReference(text: string): ImageReference {
  const invalid = (reason: string) =>
    preconditionError(
      `Image reference ${JSON.stringify(text.slice(0, 300))} is invalid: ${reason}.`,
    );
  if (text.length === 0 || text.length > 512)
    throw invalid('it must have 1 to 512 characters');
  let rest = text;
  let digest: string | null = null;
  let tag: string | null = null;
  const at = rest.indexOf('@');
  if (at !== -1) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
    if (!DIGEST.test(digest)) throw invalid('its digest is malformed');
    if (!SHA256_DIGEST.test(digest))
      throw invalid('only a sha256 digest can be verified');
  }
  const colon = rest.lastIndexOf(':');
  if (colon > rest.lastIndexOf('/')) {
    tag = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
    if (!TAG.test(tag)) throw invalid('its tag is malformed');
  }
  const slash = rest.indexOf('/');
  const first = slash === -1 ? '' : rest.slice(0, slash);
  const named =
    first === 'localhost' ||
    /[.:]/.test(first) ||
    first.toLowerCase() !== first;
  const registry = named && first !== LEGACY_DOCKER_HUB ? first : DOCKER_HUB;
  let repository = named ? rest.slice(slash + 1) : rest;
  if (registry === DOCKER_HUB && !repository.includes('/'))
    repository = `library/${repository}`;
  if (!DOMAIN.test(registry)) throw invalid('its registry host is malformed');
  if (
    !REMOTE_NAME.test(repository) ||
    `${registry}/${repository}`.length > NAME_LIMIT
  )
    throw invalid('its repository name is malformed');
  return {
    registry,
    repository,
    tag: tag ?? (digest ? null : 'latest'),
    digest,
  };
}

function loopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

/**
 * Where a registry may send the client: HTTPS, or plain HTTP on loopback
 * (Docker's default insecure range) when the registry itself is a loopback
 * one, so a remote registry cannot point it at a local service. Never a URL
 * with credentials.
 */
function permittedUrl(url: URL, from: URL): boolean {
  return (
    url.username === '' &&
    url.password === '' &&
    (url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        from.protocol === 'http:' &&
        loopbackHost(url.hostname)))
  );
}

/** The origin a registry's API answers on; docker.io goes to the mirror when one is declared. */
export function registryOrigin(
  registry: string,
  registryMirror?: string,
): string {
  const host =
    registry === DOCKER_HUB ? (registryMirror ?? DOCKER_HUB_API) : registry;
  const { hostname } = new URL(`http://${host}`);
  return `${loopbackHost(hostname) ? 'http' : 'https'}://${host}`;
}

interface Platform {
  os: string;
  architecture: string;
  variant?: string | null;
}

function parsePlatform(text: string): Platform {
  const match = PLATFORM.exec(text);
  if (!match)
    throw preconditionError(
      `Platform ${JSON.stringify(text.slice(0, 100))} is not os/architecture[/variant].`,
    );
  return { os: match[1], architecture: match[2], variant: match[3] ?? null };
}

const variantOf = (platform: Platform): string =>
  platform.variant || DEFAULT_VARIANTS[platform.architecture] || '';

const samePlatform = (a: Platform, b: Platform): boolean =>
  a.os === b.os &&
  a.architecture === b.architecture &&
  variantOf(a) === variantOf(b);

const platformName = (platform: Platform): string =>
  [platform.os, platform.architecture, platform.variant]
    .filter(Boolean)
    .join('/');

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const descriptorSchema = z.object({
  mediaType: z.string().min(1).max(255),
  digest: z.string().max(512),
  size: z.number().int().nonnegative(),
  platform: z
    .object({
      os: z.string().max(64),
      architecture: z.string().max(64),
      variant: z.string().max(64).optional(),
    })
    .optional(),
});
type Descriptor = z.infer<typeof descriptorSchema>;
const indexSchema = z.object({
  schemaVersion: z.literal(2),
  manifests: z.array(descriptorSchema).max(4096),
});
const manifestSchema = z.object({
  schemaVersion: z.literal(2),
  config: descriptorSchema,
  layers: z.array(descriptorSchema),
});
const configPlatformSchema = z.object({
  os: z.string().min(1).max(64),
  architecture: z.string().min(1).max(64),
  variant: z.string().max(64).optional(),
});
const documentSchema = z.record(z.string(), z.unknown());

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch((error: unknown) => {
    logger.debug(`Registry response body not cancelled: ${String(error)}`);
  });
}

/** The body, or null once it passes `limit` bytes. */
async function readBounded(
  response: Response,
  limit: number,
): Promise<Buffer | null> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limit) {
    await discard(response);
    return null;
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const chunk of response.body) {
      total += chunk.byteLength;
      if (total > limit) return null;
      chunks.push(chunk);
    }
  } catch (error) {
    throw externalDepError(
      'The registry connection failed while its answer was read.',
      error instanceof Error ? error : undefined,
    );
  }
  return Buffer.concat(chunks);
}

function parseJson(bytes: Buffer, what: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw externalDepError(`The registry served ${what} that is not JSON.`);
  }
}

function requireSha256(digest: string, what: string): void {
  if (!SHA256_DIGEST.test(digest))
    throw externalDepError(
      `${what} names ${JSON.stringify(digest.slice(0, 80))}, which is no sha256 digest the CLI can verify.`,
    );
}

/**
 * Index or manifest: the document's own `mediaType` and every type it was
 * declared under (the descriptor, the Content-Type) must agree, and with
 * neither the shape decides. Other types (schema 1, artifacts) are refused.
 */
function documentKind(
  document: unknown,
  declared: (string | null)[],
  what: string,
): 'index' | 'manifest' {
  const parsed = documentSchema.safeParse(document);
  const fields = parsed.success ? parsed.data : {};
  const own = typeof fields.mediaType === 'string' ? fields.mediaType : null;
  if (own !== null && !INDEX_TYPES.has(own) && !MANIFEST_TYPES.has(own))
    throw externalDepError(
      `${what} has media type ${JSON.stringify(own.slice(0, 100))}, which is no image index or manifest.`,
    );
  const kinds = new Set(
    [own, ...declared]
      .filter(
        (type): type is string =>
          type !== null && (INDEX_TYPES.has(type) || MANIFEST_TYPES.has(type)),
      )
      .map((type) => (INDEX_TYPES.has(type) ? 'index' : 'manifest')),
  );
  if (kinds.size > 1)
    throw externalDepError(`${what} declares conflicting media types.`);
  const [kind] = kinds;
  if (kind === 'index' || kind === 'manifest') return kind;
  const index = 'manifests' in fields;
  const manifest = 'config' in fields;
  if (index !== manifest) return index ? 'index' : 'manifest';
  throw externalDepError(`${what} is no image index or manifest.`);
}

function missingPlatform(
  display: string,
  wanted: string,
  available: Platform[],
): CliError {
  const names = [...new Set(available.map(platformName))].sort();
  return new ImageNotFoundError(
    `Image ${display} has no ${wanted} image; it has ${names.join(', ') || 'none'}.`,
  );
}

/** The one manifest of the platform; attestation entries (`unknown/unknown`) never match. */
function selectPlatform(
  manifests: Descriptor[],
  want: Platform,
  display: string,
): Descriptor {
  const candidates = manifests.filter(
    (entry) =>
      MANIFEST_TYPES.has(entry.mediaType) &&
      entry.platform !== undefined &&
      samePlatform(entry.platform, want),
  );
  const digests = new Set(candidates.map((entry) => entry.digest));
  if (digests.size === 0)
    throw missingPlatform(
      display,
      platformName(want),
      manifests.flatMap((entry) =>
        entry.platform &&
        entry.platform.os !== 'unknown' &&
        MANIFEST_TYPES.has(entry.mediaType)
          ? [entry.platform]
          : [],
      ),
    );
  if (digests.size > 1)
    throw externalDepError(
      `Image ${display} lists more than one ${platformName(want)} manifest.`,
    );
  return candidates[0];
}

/** One repository on one registry origin, and the reference as the caller wrote it. */
interface Target {
  origin: string;
  repository: string;
  display: string;
}

/**
 * The anonymous OCI distribution client. One client keeps its tokens per
 * registry and repository for its lifetime.
 */
export function createRegistryClient(
  options: RegistryClientOptions = {},
): RegistryClient {
  const { registryMirror, cacheDirectory } = options;
  if (registryMirror !== undefined && !DOMAIN.test(registryMirror))
    throw preconditionError(
      `Registry mirror ${JSON.stringify(registryMirror.slice(0, 300))} must be a host, optionally with a port.`,
    );
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tokens = new Map<string, string>();

  async function request(
    url: URL,
    headers: Record<string, string>,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw externalDepError(
        `Could not reach the registry at ${url.host}.`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /** Redirects are followed by hand: a token never leaves its origin. */
  async function send(
    url: URL,
    headers: Record<string, string>,
    authorization?: string,
  ): Promise<Response> {
    let target = url;
    let carried = authorization;
    for (let hop = 0; ; hop++) {
      const response = await request(
        target,
        carried ? { ...headers, Authorization: carried } : headers,
      );
      if (!REDIRECTS.has(response.status)) return response;
      await discard(response);
      const location = response.headers.get('location');
      let next: URL | null = null;
      try {
        next = location ? new URL(location, target) : null;
      } catch {
        next = null;
      }
      if (hop === MAX_REDIRECTS || next === null)
        throw externalDepError(
          `The registry at ${url.host} redirected without end or without a valid location.`,
        );
      if (!permittedUrl(next, url))
        throw externalDepError(
          `The registry at ${url.host} redirected to plain HTTP or to an address with credentials.`,
        );
      if (next.origin !== target.origin) carried = undefined;
      target = next;
    }
  }

  async function anonymousToken(
    challenge: string | null,
    target: Target,
  ): Promise<string> {
    const origin = new URL(target.origin);
    const { host } = origin;
    const bearer = challenge
      ? /(?:^|,\s*)Bearer\s+(.+)$/i.exec(challenge)
      : null;
    if (!bearer)
      throw preconditionError(
        `The registry at ${host} asks for credentials; the CLI reads public images only.`,
      );
    const parameters = new Map<string, string>();
    for (const [, key, value] of bearer[1].matchAll(/([A-Za-z]+)="([^"]*)"/g))
      parameters.set(key.toLowerCase(), value);
    let realm: URL | null = null;
    try {
      realm = new URL(parameters.get('realm') ?? '');
    } catch {
      realm = null;
    }
    if (realm === null || !permittedUrl(realm, origin))
      throw externalDepError(
        `The registry at ${host} names a token service that is not an HTTPS address.`,
      );
    const service = parameters.get('service');
    if (service) realm.searchParams.set('service', service);
    realm.searchParams.set('scope', `repository:${target.repository}:pull`);
    const response = await send(realm, { Accept: 'application/json' });
    if (response.status !== 200) {
      await discard(response);
      // GHCR denies a token for a repository that is missing or private.
      if (response.status === 401 || response.status === 403)
        throw anonymousRefused(target.display);
      throw externalDepError(
        `The token service of the registry at ${host} answered HTTP ${response.status}.`,
      );
    }
    const bytes = await readBounded(response, TOKEN_LIMIT);
    const parsed = z
      .object({
        token: z.string().optional(),
        access_token: z.string().optional(),
      })
      .safeParse(bytes === null ? null : parseJson(bytes, 'a token'));
    const token = parsed.success
      ? parsed.data.token || parsed.data.access_token
      : undefined;
    if (!token || !/^[\x21-\x7e]{1,16384}$/.test(token))
      throw externalDepError(
        `The token service of the registry at ${host} returned no usable token.`,
      );
    return token;
  }

  /** One GET under the repository's anonymous token, asked for once a challenge comes. */
  async function registryGet(
    target: Target,
    path: string,
    accept?: string,
  ): Promise<Response> {
    const key = `${target.origin} ${target.repository}`;
    const headers: Record<string, string> = accept ? { Accept: accept } : {};
    for (let challenged = false; ; challenged = true) {
      const token = tokens.get(key);
      const response = await send(
        new URL(`/v2/${target.repository}/${path}`, target.origin),
        headers,
        token ? `Bearer ${token}` : undefined,
      );
      if (response.status !== 401 || challenged) return response;
      await discard(response);
      tokens.set(
        key,
        await anonymousToken(response.headers.get('www-authenticate'), target),
      );
    }
  }

  async function requireOk(
    response: Response,
    target: Target,
    notFound: () => CliError,
  ): Promise<void> {
    if (response.status === 200) return;
    await discard(response);
    if (response.status === 404) throw notFound();
    if (response.status === 401 || response.status === 403)
      throw anonymousRefused(target.display);
    throw externalDepError(
      `The registry answered HTTP ${response.status} for ${target.display}.`,
    );
  }

  function cachePath(digest: string): string | null {
    return cacheDirectory
      ? join(cacheDirectory, 'blobs', 'sha256', digest.slice('sha256:'.length))
      : null;
  }

  /** A cached blob whose bytes still hash to its name; anything else is fetched again. */
  function readCache(digest: string, limit: number): Buffer | null {
    const file = cachePath(digest);
    if (file === null) return null;
    try {
      const info = lstatSync(file);
      if (info.isFile() && info.size <= limit) {
        const bytes = readFileSync(file);
        if (sha256(bytes) === digest) return bytes;
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return null;
      throw error;
    }
    logger.warn(
      `Discarding the cached ${digest}: it no longer holds the bytes of its digest.`,
    );
    return null;
  }

  function writeCache(digest: string, bytes: Buffer): void {
    const file = cachePath(digest);
    if (file === null) return;
    const directory = dirname(file);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.pending-${randomUUID()}`);
    try {
      writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, file);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  /**
   * A manifest or blob by digest: from the cache, else fetched, verified and
   * cached. `size` is the descriptor's; only a pinned reference has none.
   */
  async function byDigest(
    target: Target,
    kind: 'manifests' | 'blobs',
    digest: string,
    size: number | null,
    limit: number,
  ): Promise<Buffer> {
    const cap = size ?? limit;
    if (cap > limit)
      throw externalDepError(
        `Image ${target.display} names ${digest} of ${cap} bytes, more than the ${limit} the CLI reads.`,
      );
    const cached = readCache(digest, cap);
    if (cached !== null && (size === null || cached.byteLength === size))
      return cached;
    const response = await registryGet(
      target,
      `${kind}/${digest}`,
      kind === 'manifests' ? ACCEPT : undefined,
    );
    await requireOk(response, target, () =>
      size === null
        ? imageNotFound(target.display)
        : externalDepError(
            `The registry lacks ${digest} of image ${target.display}.`,
          ),
    );
    const bytes = await readBounded(response, cap);
    if (
      bytes === null ||
      (size !== null && bytes.byteLength !== size) ||
      sha256(bytes) !== digest
    )
      throw externalDepError(
        `The registry served bytes for ${target.display} that do not match ${digest}.`,
      );
    writeCache(digest, bytes);
    return bytes;
  }

  /** The manifest a tag names now; its digest is the bytes', checked against the registry's own. */
  async function byTag(
    target: Target,
    tag: string,
  ): Promise<{ bytes: Buffer; digest: string; contentType: string | null }> {
    const response = await registryGet(target, `manifests/${tag}`, ACCEPT);
    await requireOk(response, target, () => imageNotFound(target.display));
    const bytes = await readBounded(response, MANIFEST_LIMIT);
    if (bytes === null)
      throw externalDepError(
        `The registry served a manifest for ${target.display} larger than the ${MANIFEST_LIMIT} bytes the CLI reads.`,
      );
    const digest = sha256(bytes);
    const announced = response.headers.get('docker-content-digest');
    if (
      announced !== null &&
      SHA256_DIGEST.test(announced) &&
      announced !== digest
    )
      throw externalDepError(
        `The registry served bytes for ${target.display} that do not match ${announced}.`,
      );
    writeCache(digest, bytes);
    const contentType = response.headers.get('content-type');
    return {
      bytes,
      digest,
      contentType: contentType ? contentType.split(';')[0].trim() : null,
    };
  }

  /** The platform's manifest: the top document itself, or the index entry for the platform. */
  async function platformManifest(
    target: Target,
    top: { bytes: Buffer; digest: string; contentType: string | null },
    want: Platform,
  ): Promise<{ digest: string; document: unknown }> {
    const { display } = target;
    const document = parseJson(top.bytes, `the manifest of ${display}`);
    const what = `The manifest of ${display}`;
    if (documentKind(document, [top.contentType], what) === 'manifest')
      return { digest: top.digest, document };
    const index = indexSchema.safeParse(document);
    if (!index.success)
      throw externalDepError(`The image index of ${display} is malformed.`);
    const descriptor = selectPlatform(index.data.manifests, want, display);
    requireSha256(descriptor.digest, `The image index of ${display}`);
    const entry = parseJson(
      await byDigest(
        target,
        'manifests',
        descriptor.digest,
        descriptor.size,
        MANIFEST_LIMIT,
      ),
      `the ${platformName(want)} manifest of ${display}`,
    );
    const entryWhat = `The ${platformName(want)} manifest of ${display}`;
    if (documentKind(entry, [descriptor.mediaType], entryWhat) !== 'manifest')
      throw externalDepError(
        `${entryWhat} is a nested index, which the CLI does not read.`,
      );
    return { digest: descriptor.digest, document: entry };
  }

  async function resolve(
    referenceText: string,
    platformText: string,
  ): Promise<ResolvedImage> {
    const reference = parseImageReference(referenceText);
    const want = parsePlatform(platformText);
    const target: Target = {
      origin: registryOrigin(reference.registry, registryMirror),
      repository: reference.repository,
      display: referenceText,
    };
    const top =
      reference.digest === null
        ? await byTag(target, reference.tag ?? 'latest')
        : {
            bytes: await byDigest(
              target,
              'manifests',
              reference.digest,
              null,
              MANIFEST_LIMIT,
            ),
            digest: reference.digest,
            contentType: null,
          };
    const platform = await platformManifest(target, top, want);
    const manifest = manifestSchema.safeParse(platform.document);
    if (!manifest.success)
      throw externalDepError(
        `The image manifest of ${referenceText} is malformed.`,
      );
    const descriptor = manifest.data.config;
    if (!CONFIG_TYPES.has(descriptor.mediaType))
      throw preconditionError(
        `Image ${referenceText} is no container image: its config has media type ${JSON.stringify(descriptor.mediaType.slice(0, 100))}.`,
      );
    requireSha256(descriptor.digest, `The image manifest of ${referenceText}`);
    const config = parseJson(
      await byDigest(
        target,
        'blobs',
        descriptor.digest,
        descriptor.size,
        CONFIG_LIMIT,
      ),
      `the image config of ${referenceText}`,
    );
    const identity = configPlatformSchema.safeParse(config);
    if (!identity.success)
      throw externalDepError(
        `The image config of ${referenceText} names no os and architecture.`,
      );
    if (!samePlatform(identity.data, want))
      throw missingPlatform(referenceText, platformText, [identity.data]);
    return {
      reference: `${reference.registry}/${reference.repository}@${top.digest}`,
      digest: top.digest,
      manifestDigest: platform.digest,
      configDigest: descriptor.digest,
      os: identity.data.os,
      architecture: identity.data.architecture,
      variant: identity.data.variant ?? null,
      config,
    };
  }

  return { resolve };
}
