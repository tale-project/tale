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
import { incusOf } from './incus-session-spec.ts';

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
  // The owner of a new workspace volume, and the creation time the platform's
  // cleanup protects a young workspace by.
  'storage_initial_owner',
  'storage_volumes_created_at',
] as const;

/** The tmpfs /dev/shm device. */
const TMPFS_EXTENSION = 'container_disk_tmpfs';

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

export function inspectIncus(
  cfg: SpawnerConfig,
  survey: IncusSurvey,
): IncusFindings {
  const incus = incusOf(cfg);
  const { server, project, profile, network, pool } = survey;
  const errors: string[] = [];
  const warnings: string[] = [];
  const projectName = incus.project;

  // ---- the server ---------------------------------------------------------
  const wanted: string[] = [...REQUIRED_EXTENSIONS];
  if (incus.shmDevice) wanted.push(TMPFS_EXTENSION);
  const missing = wanted.filter(
    (extension) => !server.apiExtensions.includes(extension),
  );
  if (missing.length > 0) {
    errors.push(
      `Incus ${server.serverVersion || '(unknown version)'} lacks the API extensions ${missing.join(', ')}; Incus 7.0 or newer has them all`,
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
    if (incus.shmDevice) {
      const disks = project.config['restricted.devices.disk'];
      const paths = list(project.config['restricted.devices.disk.paths']);
      if (disks !== 'allow') {
        errors.push(
          `project ${projectName} does not allow the tmpfs /dev/shm device. Run: incus project set ${projectName} restricted.devices.disk=allow restricted.devices.disk.paths=tmpfs:  (or set SANDBOX_INCUS_SHM_DEVICE=false and accept the image's 64 MiB /dev/shm, which crashes Chromium)`,
        );
      } else if (paths.length === 0) {
        warnings.push(
          `project ${projectName} allows disk devices without restricted.devices.disk.paths, so this certificate could mount any host path into an instance. Run: incus project set ${projectName} restricted.devices.disk.paths=tmpfs:`,
        );
      } else if (!paths.includes('tmpfs:')) {
        errors.push(
          `project ${projectName} restricts disk devices to ${paths.join(', ')}, which does not admit the tmpfs /dev/shm device. Run: incus project set ${projectName} restricted.devices.disk.paths=tmpfs:`,
        );
      }
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
    const [, nic] = onNetwork[0] ?? [];
    const acls =
      list(nic?.['security.acls']).length > 0 ||
      list(network.config['security.acls']).length > 0;
    if (!acls) {
      const text = `no network ACL applies to sessions: neither network ${incus.network} nor profile ${incus.profile}'s NIC sets security.acls, so a session could reach every address its bridge can. Attach an ACL that admits only the egress proxy, the resolver and the platform (docs/incus.md)`;
      if (incus.allowUnfilteredNetwork) {
        warnings.push(
          `${text} — SANDBOX_INCUS_ALLOW_UNFILTERED_NETWORK is set, so this is allowed`,
        );
      } else {
        errors.push(
          `${text}. (Set SANDBOX_INCUS_ALLOW_UNFILTERED_NETWORK=true only for a lab.)`,
        );
      }
    }
    if (nic?.['security.port_isolation'] !== 'true') {
      warnings.push(
        `profile ${incus.profile}'s NIC does not isolate its port (security.port_isolation): sessions on ${incus.network} can reach each other at layer 2 unless the ACL forbids it`,
      );
    }
  }
  const root = Object.values(profile.devices).find(
    (device) => device.type === 'disk' && device.path === '/',
  );
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
