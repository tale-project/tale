import { IncusApiError } from '@tale/incus/api';
import type { IncusClient } from '@tale/incus/client';

/**
 * Whether an Incus server and the project the stack lives in can run a
 * Tale stack (design D-05, D-06, 5.1). The probe reads what the stack's
 * restricted certificate may read — the server's description, the project,
 * the `tale-stack` profile and the storage pool — and refuses what could only
 * fail later as an opaque create error, naming what to change.
 *
 * What it requires:
 * - the API extensions of D-06, by name, never by version: OCI instances with
 *   an entrypoint and a network config, shifted volumes with an initial
 *   owner, the volume file API, a restricted project's snapshots and image
 *   servers, and `boot.autorestart`. `instance_port_forward` is not one of
 *   them: it is the raw TCP port-forward API, not proxy devices (R-10);
 * - a single server: a cluster member is refused (D-05);
 * - idmapped mounts, which a shifted volume needs: a kernel that says it has
 *   none is refused, and so is a ZFS older than 2.2;
 * - a project with its own images, profiles and volumes, and, where the
 *   project sets `limits.memory` or `limits.processes`, a `tale-stack`
 *   profile that sets them too (Incus refuses an instance without them,
 *   R3-12);
 * - every registry the stack pulls from listed in
 *   `restricted.images.servers` exactly as the CLI's remote URL carries its
 *   host (Incus compares them character for character, R3-12).
 */

/** The API extensions the stack needs (design D-06). */
export const REQUIRED_EXTENSIONS = [
  'instance_oci',
  'instance_oci_entrypoint',
  'oci_network_config',
  'storage_shifted',
  'storage_initial_owner',
  'file_storage_volume',
  'projects_restricted_backups_and_snapshots',
  'projects_restricted_image_servers',
  'instance_auto_restart',
] as const;

/** The profile every stack instance is made with (design 5.1). */
export const STACK_PROFILE = 'tale-stack';

/** The oldest OpenZFS whose datasets support idmapped mounts. */
const MIN_ZFS = [2, 2] as const;
/** Pool drivers that enforce a volume's size. */
const QUOTA_DRIVERS = new Set(['zfs', 'btrfs', 'lvm', 'lvmcluster', 'ceph']);

/** Incus's architecture names, as an OCI image platform names them. */
const PLATFORM_ARCHITECTURES: Record<string, string> = {
  x86_64: 'amd64',
  aarch64: 'arm64',
  armv7l: 'arm/v7',
  armv8l: 'arm/v7',
  ppc64le: 'ppc64le',
  s390x: 's390x',
  riscv64: 'riscv64',
};

export interface ProbeRequest {
  /** The pool the stack's volumes and root disks come from. */
  pool: string;
  /** Registry hosts the stack pulls from, exactly as its remote URLs carry
   * them (`ghcr.io`, `mirror.gcr.io:443`). */
  registries: readonly string[];
}

export interface IncusServerFacts {
  version: string;
  /** Incus's name for the server's own architecture (`x86_64`). */
  architecture: string;
  /** The image platform that architecture runs (`linux/amd64`). */
  platform: string;
  poolDriver: string;
}

export interface IncusProbe {
  /** Why the stack cannot run here. */
  errors: string[];
  /** What is allowed, but worth knowing. */
  warnings: string[];
  /** What the server is; null when it could not be read. */
  facts: IncusServerFacts | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** `2.4.1-1ubuntu5.1` → [2, 4]; null when it does not start with numbers. */
function majorMinor(version: string): [number, number] | null {
  const match = /^(\d+)\.(\d+)/.exec(version);
  return match === null ? null : [Number(match[1]), Number(match[2])];
}

/** The OCI platform an Incus architecture runs; null for one Tale ships
 * no image for. */
export function platformOf(architecture: string): string | null {
  const name = PLATFORM_ARCHITECTURES[architecture];
  return name === undefined ? null : `linux/${name}`;
}

interface ServerDescription {
  extensions: string[];
  auth: string;
  version: string;
  architectures: string[];
  clustered: boolean;
  kernelFeatures: Record<string, unknown>;
  drivers: { name: string; version: string }[];
}

/** `GET /1.0`, read for the fields the probe needs (the client's parser
 * keeps fewer). */
async function describeServer(client: IncusClient): Promise<ServerDescription> {
  const raw = await client.sync('GET', '/1.0', { retry: true });
  if (!isRecord(raw))
    throw new IncusApiError(
      'Incus answered a malformed server description',
      502,
    );
  const environment = isRecord(raw.environment) ? raw.environment : {};
  const drivers = Array.isArray(environment.storage_supported_drivers)
    ? environment.storage_supported_drivers.filter(isRecord).map((driver) => ({
        name: typeof driver.name === 'string' ? driver.name : '',
        version: typeof driver.version === 'string' ? driver.version : '',
      }))
    : [];
  return {
    extensions: strings(raw.api_extensions),
    auth: typeof raw.auth === 'string' ? raw.auth : '',
    version:
      typeof environment.server_version === 'string'
        ? environment.server_version
        : '',
    architectures: strings(environment.architectures),
    clustered: environment.server_clustered === true,
    kernelFeatures: isRecord(environment.kernel_features)
      ? environment.kernel_features
      : {},
    drivers,
  };
}

/** Read the server, the project, the stack profile and the pool, and say
 * whether the stack can run there. Throws only when Incus cannot be reached
 * at all; everything it can judge comes back as an error or a warning. */
export async function probeIncus(
  client: IncusClient,
  request: ProbeRequest,
): Promise<IncusProbe> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const project = client.project;

  // ---- the server ----------------------------------------------------------
  const server = await describeServer(client);
  if (server.auth !== 'trusted') {
    errors.push(
      'the Incus server does not trust the client certificate: add it to the trust store, restricted to the stack project (incus config trust add-certificate <client.crt> --restricted --projects <project>)',
    );
    return { errors, warnings, facts: null };
  }
  const missing = REQUIRED_EXTENSIONS.filter(
    (extension) => !server.extensions.includes(extension),
  );
  if (missing.length > 0)
    errors.push(
      `Incus ${server.version || '(unknown version)'} lacks the API extensions ${missing.join(', ')}; upgrade Incus (7.2 or newer has them all)`,
    );
  if (server.clustered)
    errors.push(
      'the Incus server is a cluster member; a Tale stack runs on a single Incus server only',
    );
  const architecture = server.architectures[0] ?? '';
  const platform = platformOf(architecture);
  if (platform === null)
    errors.push(
      architecture === ''
        ? 'the Incus server names no architecture'
        : `the Incus server runs ${architecture}, an architecture Tale ships no images for`,
    );
  if (server.kernelFeatures.idmapped_mounts === 'false')
    errors.push(
      'the Incus server reports no idmapped mounts (kernel_features), which every stack volume needs (security.shifted); they need Linux 5.12 or newer',
    );

  // ---- the project ------------------------------------------------------------
  const projectInfo = await client.getProject();
  const config = projectInfo.config;
  for (const feature of [
    'features.images',
    'features.profiles',
    'features.storage.volumes',
  ])
    if (config[feature] !== 'true')
      errors.push(
        `project ${project} has ${feature} off, so the stack would share the default project's; run: incus project set ${project} ${feature}=true`,
      );
  const restricted = config.restricted === 'true';
  if (!restricted)
    warnings.push(
      `project ${project} is not restricted: nothing but the certificate's project binding limits what a stack instance may be given; run: incus project set ${project} restricted=true`,
    );
  else {
    if (config['restricted.containers.lowlevel'] === 'allow')
      warnings.push(
        `project ${project} allows low-level container keys (restricted.containers.lowlevel=allow), which admits raw.lxc; the stack needs none`,
      );
    const servers = list(config['restricted.images.servers']);
    const refused = request.registries.filter(
      (registry) => !servers.includes(registry),
    );
    if (refused.length > 0)
      errors.push(
        `project ${project} does not let the stack pull from ${refused.join(', ')} (restricted.images.servers is ${servers.length === 0 ? 'empty' : servers.join(',')}; Incus matches each host exactly as the remote URL carries it); run: incus project set ${project} restricted.images.servers=${[...new Set([...servers, ...refused])].join(',')}`,
      );
  }

  // ---- the stack profile --------------------------------------------------------
  let profile: Awaited<ReturnType<IncusClient['getProfile']>> | null = null;
  try {
    profile = await client.getProfile(STACK_PROFILE);
  } catch (error) {
    if (!(error instanceof IncusApiError && error.status === 404)) throw error;
    errors.push(
      `project ${project} has no profile ${STACK_PROFILE}; create it with a root disk on pool ${request.pool} (tale incus contract prints it)`,
    );
  }
  if (profile !== null) {
    for (const limit of ['limits.memory', 'limits.processes']) {
      const value = config[limit];
      if (value !== undefined && value !== '' && !profile.config[limit])
        errors.push(
          `project ${project} sets ${limit} (${value}), so Incus refuses every instance without its own, and profile ${STACK_PROFILE} sets none; run: incus profile set ${STACK_PROFILE} ${limit}=<default> --project ${project}`,
        );
    }
    const root = Object.values(profile.devices).find(
      (device) => device.type === 'disk' && device.path === '/',
    );
    if (root === undefined)
      errors.push(
        `profile ${STACK_PROFILE} has no root disk; add one on pool ${request.pool}: incus profile device add ${STACK_PROFILE} root disk path=/ pool=${request.pool} --project ${project}`,
      );
    else if (root.pool !== request.pool)
      warnings.push(
        `profile ${STACK_PROFILE}'s root disk is on pool ${root.pool ?? '(none)'}, not ${request.pool}`,
      );
  }

  // ---- the pool ---------------------------------------------------------------
  let poolDriver = '';
  try {
    poolDriver = (await client.getStoragePool(request.pool)).driver;
  } catch (error) {
    if (!(error instanceof IncusApiError && error.status === 404)) throw error;
    errors.push(
      `storage pool ${request.pool} does not exist, or project ${project} may not use it (restricted.storage-pools.access)`,
    );
  }
  if (poolDriver !== '') {
    if (!QUOTA_DRIVERS.has(poolDriver))
      warnings.push(
        `storage pool ${request.pool} uses the ${poolDriver} driver, which cannot enforce a volume's size; use zfs, btrfs or lvm`,
      );
    if (poolDriver === 'zfs') {
      const zfs = server.drivers.find((driver) => driver.name === 'zfs');
      const version = zfs === undefined ? null : majorMinor(zfs.version);
      if (version === null)
        warnings.push(
          'the Incus server does not say which ZFS it runs; shifted volumes on ZFS need OpenZFS 2.2 or newer',
        );
      else if (
        version[0] < MIN_ZFS[0] ||
        (version[0] === MIN_ZFS[0] && version[1] < MIN_ZFS[1])
      )
        errors.push(
          `storage pool ${request.pool} is ZFS ${zfs?.version}, whose datasets have no idmapped mounts; shifted volumes need OpenZFS 2.2 or newer`,
        );
    }
  }

  return {
    errors,
    warnings,
    facts:
      platform === null
        ? null
        : {
            version: server.version,
            architecture,
            platform,
            poolDriver,
          },
  };
}
