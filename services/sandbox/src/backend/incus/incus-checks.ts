// What the Incus backend requires of the node it runs on, read from the
// project, profile, network and storage pool it was told to use. Boot refuses
// (in words that say what to change) what could only fail later as an opaque
// create error, or leave sessions less contained than the operator believes,
// and warns about what is allowed but worth knowing.

import type { SpawnerConfig } from '../../types.ts';
import type {
  IncusNetwork,
  IncusProfile,
  IncusProject,
  IncusServerInfo,
  IncusStoragePool,
} from './incus-api.ts';
import { incusOf, sessionShape } from './incus-session-spec.ts';
import { incusSizeBytes } from './incus-units.ts';

/** API extensions every Incus deployment of the backend needs (all in
 * Incus 7.0). */
const REQUIRED_EXTENSIONS = [
  // OCI application containers from the runtime image, with an entrypoint
  // and resolver the spawner sets.
  'instance_oci',
  'instance_oci_entrypoint',
  'oci_network_config',
  // A create that starts in the same operation.
  'instance_create_start',
  // A workspace volume several isolated instances can mount in turn.
  'storage_shifted',
  // The owner of a new workspace volume, and the creation time the platform's
  // cleanup protects a young workspace by.
  'storage_initial_owner',
  'storage_volumes_created_at',
] as const;

export interface IncusSurvey {
  server: IncusServerInfo;
  project: IncusProject;
  profile: IncusProfile;
  network: IncusNetwork;
  pool: IncusStoragePool;
}

export interface IncusFindings {
  /** Why the backend cannot run here. */
  errors: string[];
  /** What is allowed, but worth the operator's attention. */
  warnings: string[];
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** A project limit that holds a whole number, or undefined. */
function countOf(value: string | undefined): number | undefined {
  if (value === undefined || !/^[0-9]+$/.test(value)) return undefined;
  return Number(value);
}

/**
 * Incus refuses a create once the instances of a project would pass one of the
 * project's own limits, and the spawner admits by its session capacity alone.
 * A limit below what the capacity can add up to is not an error — an operator
 * may mean it — but a create past it fails with an Incus message, so boot says
 * so. Standbys and sessions together stay within the capacity; a warm-up
 * instance comes on top for a moment.
 */
function warnProjectCapacity(
  cfg: SpawnerConfig,
  projectConfig: Record<string, string>,
  projectName: string,
  warnings: string[],
): void {
  const capacity = cfg.session.maxSessions;
  const shape = sessionShape(cfg, 'agent');
  const instances = countOf(projectConfig['limits.instances']);
  if (instances !== undefined && instances < capacity + 1) {
    warnings.push(
      `project ${projectName} allows ${instances} instances (limits.instances), fewer than SANDBOX_MAX_SESSIONS (${capacity}) plus the image warm-up's: a create past the limit fails`,
    );
  }
  const containers = countOf(projectConfig['limits.containers']);
  if (containers !== undefined && containers < capacity + 1) {
    warnings.push(
      `project ${projectName} allows ${containers} containers (limits.containers), fewer than SANDBOX_MAX_SESSIONS (${capacity}) plus the image warm-up's: a create past the limit fails`,
    );
  }
  const memoryLimit = projectConfig['limits.memory'];
  const memory =
    memoryLimit === undefined ? undefined : incusSizeBytes(memoryLimit);
  const perSession = incusSizeBytes(shape.limits.memory);
  if (
    memory !== undefined &&
    perSession !== undefined &&
    memory < capacity * perSession
  ) {
    warnings.push(
      `project ${projectName} caps the sessions' memory limits at ${memoryLimit} (limits.memory), less than SANDBOX_MAX_SESSIONS (${capacity}) times ${shape.limits.memory}: a create fails once their limits add up to it`,
    );
  }
  const processes = countOf(projectConfig['limits.processes']);
  const pids = shape.dind
    ? Math.max(shape.limits.pidsLimit, 16384)
    : shape.limits.pidsLimit;
  if (processes !== undefined && processes < capacity * pids) {
    warnings.push(
      `project ${projectName} caps the sessions' process limits at ${processes} (limits.processes), less than SANDBOX_MAX_SESSIONS (${capacity}) times ${pids}: a create fails once their limits add up to it`,
    );
  }
}

export function inspectIncus(
  cfg: SpawnerConfig,
  survey: IncusSurvey,
): IncusFindings {
  const incus = incusOf(cfg);
  const { server, project, profile, network, pool } = survey;
  const errors: string[] = [];
  const warnings: string[] = [];
  const projectName = incus.project;

  // ---- the shared memory --------------------------------------------------
  // The entrypoint mounts a /dev/shm of the profile's size, in a size syntax
  // of its own: a number and k, m or g, as Docker reads SANDBOX_AGENT_SHM_SIZE.
  const shm = sessionShape(cfg, 'agent').limits.shmSize;
  if (!/^[1-9][0-9]*[kmgKMG]?$/.test(shm)) {
    errors.push(
      `SANDBOX_AGENT_SHM_SIZE is ${JSON.stringify(shm)}, which is not a size the session's entrypoint mounts /dev/shm with (a number and k, m or g, such as 512m)`,
    );
  }

  // ---- the server ---------------------------------------------------------
  const missing = REQUIRED_EXTENSIONS.filter(
    (extension) => !server.apiExtensions.includes(extension),
  );
  if (missing.length > 0) {
    errors.push(
      `Incus ${server.serverVersion || '(unknown version)'} lacks the API extensions ${missing.join(', ')}; Incus 7.0 or newer has them all`,
    );
  }

  // A workspace volume is shifted so that each instance, with an idmap of its
  // own, mounts it without a recursive chown. Incus does that with idmapped
  // mounts, which the kernel and the volume's filesystem must support.
  if (server.kernelFeatures.idmapped_mounts === 'false') {
    warnings.push(
      `the Incus server reports no idmapped mounts (kernel_features), which a shifted workspace volume needs: a session's workspace may fail to mount or not be writable. They need Linux 5.12 or newer and a storage driver that supports them`,
    );
  }

  // ---- the project --------------------------------------------------------
  const restricted = project.config.restricted === 'true';
  if (project.config['features.storage.volumes'] !== 'true') {
    errors.push(
      `project ${projectName} has features.storage.volumes off, so workspace volumes would be made in the default project, which this certificate may only view, and be shared by every environment. Run: incus project set ${projectName} features.storage.volumes=true`,
    );
  }
  if (project.config['features.images'] !== 'true') {
    warnings.push(
      `project ${projectName} has features.images off: the runtime image is looked up in the default project, which this certificate may only view, so the spawner cannot import or pull it (do that as an administrator)`,
    );
  }
  if (!restricted) {
    warnings.push(
      `project ${projectName} is not restricted: nothing but the client certificate's own project binding limits what a session instance can be given. Run: incus project set ${projectName} restricted=true`,
    );
  } else {
    if (project.config['restricted.containers.lowlevel'] === 'allow') {
      warnings.push(
        `project ${projectName} allows low-level container keys (restricted.containers.lowlevel=allow), which also admits raw.lxc; the backend does not need them`,
      );
    }
    // The backend asks for pool-backed disks only (the workspace volume and the
    // profile's root disk), which is what a restricted project admits by
    // default. `allow` without a list of paths admits every host path.
    if (
      project.config['restricted.devices.disk'] === 'allow' &&
      list(project.config['restricted.devices.disk.paths']).length === 0
    ) {
      warnings.push(
        `project ${projectName} allows disk devices from any host path (restricted.devices.disk=allow without restricted.devices.disk.paths), so this certificate could mount a host directory into an instance. The backend needs pool-backed disks only, the default. Run: incus project unset ${projectName} restricted.devices.disk`,
      );
    }
    if (cfg.dockerInContainer) {
      if (project.config['restricted.containers.nesting'] !== 'allow') {
        errors.push(
          `Docker inside a session needs container nesting, which project ${projectName} does not allow. Run: incus project set ${projectName} restricted.containers.nesting=allow`,
        );
      }
      const intercepts = Object.entries(incus.dockerConfig).some(
        ([key, value]) =>
          key.startsWith('security.syscalls.intercept.') &&
          value !== '' &&
          value !== 'false',
      );
      if (
        intercepts &&
        project.config['restricted.containers.interception'] !== 'allow'
      ) {
        errors.push(
          `Docker inside a session needs syscall interception, which project ${projectName} does not allow. Run: incus project set ${projectName} restricted.containers.interception=allow`,
        );
      }
    }
  }

  // ---- the project's aggregate limits ----------------------------------------
  // Incus adds up an instance limit over every instance of a project that
  // carries a project limit of the same name, and refuses an instance that
  // does not define it itself or through its profile. Sessions define
  // limits.memory and limits.processes (and the volumes their size), and limit
  // CPU through limits.cpu.allowance, not limits.cpu.
  const rootDevice = Object.values(profile.devices).find(
    (device) => device.type === 'disk' && device.path === '/',
  );
  const cpuLimit = project.config['limits.cpu'];
  if (
    cpuLimit !== undefined &&
    cpuLimit !== '' &&
    (profile.config['limits.cpu'] ?? '') === ''
  ) {
    errors.push(
      `project ${projectName} sets limits.cpu (${cpuLimit}), so Incus refuses every instance that does not define limits.cpu itself, and this backend limits CPU with limits.cpu.allowance. Run: incus project unset ${projectName} limits.cpu`,
    );
  }
  const diskLimit = Object.keys(project.config).find(
    (key) =>
      (key === 'limits.disk' || key.startsWith('limits.disk.pool.')) &&
      (project.config[key] ?? '') !== '',
  );
  if (
    diskLimit !== undefined &&
    (rootDevice?.size === undefined || rootDevice.size === '')
  ) {
    errors.push(
      `project ${projectName} sets ${diskLimit}, so Incus refuses every instance whose root disk has no size, and profile ${incus.profile}'s root disk has none. Run: incus profile device set ${incus.profile} root size=30GiB --project ${projectName}`,
    );
  }
  warnProjectCapacity(cfg, project.config, projectName, warnings);

  // ---- the network and the profile that owns the NIC -----------------------
  if (!network.managed) {
    errors.push(
      `network ${incus.network} is not managed by Incus, so no network ACL can apply to it; point SANDBOX_INCUS_NETWORK at the managed bridge sessions are meant to use`,
    );
  }
  const nics = Object.entries(profile.devices).filter(
    ([, device]) => device.type === 'nic',
  );
  const onNetwork = nics.filter(
    ([, device]) =>
      device.network === incus.network || device.parent === incus.network,
  );
  if (nics.length === 0) {
    errors.push(
      `profile ${incus.profile} has no network device: sessions would have no network. Add one on ${incus.network}: incus profile device add ${incus.profile} eth0 nic network=${incus.network}`,
    );
  } else if (onNetwork.length === 0) {
    errors.push(
      `profile ${incus.profile}'s network device is not on ${incus.network} (SANDBOX_INCUS_NETWORK) but on ${nics.map(([, device]) => device.network ?? device.parent ?? 'no network').join(', ')}`,
    );
  } else {
    // The instance has no NIC of its own (an instance device of the profile's
    // name would replace the profile's wholesale, ACL and isolation with it),
    // so this NIC is the whole of a session's network containment.
    const [nicName, nic] = onNetwork[0] ?? [];
    // Incus shows a network's configuration to administrators only ("sensitive
    // info can be stored there"): the restricted certificate this backend runs
    // with gets none, so an ACL attached to the network alone cannot be seen,
    // however well it works. Only the profile's NIC can vouch for one.
    const networkHidden = Object.keys(network.config).length === 0;
    const acls =
      list(nic?.['security.acls']).length > 0 ||
      list(network.config['security.acls']).length > 0;
    if (!acls) {
      const text = networkHidden
        ? `no network ACL is visible to the spawner: profile ${incus.profile}'s NIC sets no security.acls, and this certificate cannot read network ${incus.network}'s configuration (Incus shows it to administrators only), so an ACL attached to the network alone cannot be seen. Name the ACL on the profile's NIC as well, which Incus applies together with the network's: incus profile device set ${incus.profile} ${nicName ?? 'eth0'} security.acls=<acl> --project ${projectName} (services/sandbox/docs/incus.md has an example)`
        : `no network ACL applies to sessions: neither network ${incus.network} nor profile ${incus.profile}'s NIC sets security.acls, so a session could reach every address its bridge can. Attach an ACL that admits only the egress proxy, the resolver and the platform (services/sandbox/docs/incus.md has an example)`;
      if (incus.allowUnfilteredNetwork) {
        warnings.push(
          `${text} — SANDBOX_INCUS_ALLOW_UNFILTERED_NETWORK is set, so this is allowed`,
        );
      } else {
        errors.push(
          `${text}. (Set SANDBOX_INCUS_ALLOW_UNFILTERED_NETWORK=true only for a lab, or when you know the network's ACL applies.)`,
        );
      }
    }
    if (nic?.['security.port_isolation'] !== 'true') {
      warnings.push(
        `profile ${incus.profile}'s NIC does not isolate its port (security.port_isolation): sessions on ${incus.network} can reach each other at layer 2 unless the ACL forbids it`,
      );
    }
  }
  const root = rootDevice;
  if (root === undefined || root.pool !== incus.storagePool) {
    warnings.push(
      `profile ${incus.profile}'s root disk is not on pool ${incus.storagePool} (SANDBOX_INCUS_STORAGE_POOL)${root?.pool === undefined ? '' : `: it is on ${root.pool}`}; instances then copy the image instead of cloning it`,
    );
  }
  if (root?.size === undefined || root.size === '') {
    warnings.push(
      `profile ${incus.profile}'s root disk has no size, so a session's root filesystem is not capped`,
    );
  }

  // ---- the storage pool ----------------------------------------------------
  if (pool.driver === 'dir') {
    warnings.push(
      `storage pool ${pool.name} uses the dir driver, which cannot enforce the ${incus.workspaceSize} workspace quota; use zfs, btrfs or lvm`,
    );
  }
  return { errors, warnings };
}
