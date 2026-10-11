// The lab as the suites see it: lab.sh `lab-file` writes it after it has built
// the node, and every suite reads it, so a name or a path lives in one place.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LabConfig {
  /** Where the lab keeps its certificates, logs and reports. */
  stateDir: string;
  /** The Incus API the spawner is given: https://127.0.0.1:8443. */
  endpoint: string;
  project: string;
  profile: string;
  network: string;
  pool: string;
  acl: string;
  /** The image alias of the project. */
  image: string;
  /** Where the spawner pulls the runtime image from (the local registry). */
  imageSource: string;
  clientCertFile: string;
  clientKeyFile: string;
  /** The node's pinnable server certificate. */
  serverCertFile: string;
  /** Incus's own server certificate (CA:FALSE), which Bun cannot pin. */
  defaultServerCertFile: string;
  /** Another pinnable server certificate: the wrong anchor. */
  otherServerCertFile: string;
  egressProxy: string;
  /** The node's address on the sandbox bridge, which the spawner calls from. */
  bridgeAddress: string;
  egressAddress: string;
  /** Stand-in addresses of the LLM gateway and the backend (the node's own). */
  gatewayAddress: string;
  backendAddress: string;
  /** The egress proxy's instance, in the default project. */
  egressInstance: string;
  /** The image alias of the egress proxy, in the default project. */
  egressImage: string;
}

const FIELDS = [
  'stateDir',
  'endpoint',
  'project',
  'profile',
  'network',
  'pool',
  'acl',
  'image',
  'imageSource',
  'clientCertFile',
  'clientKeyFile',
  'serverCertFile',
  'defaultServerCertFile',
  'otherServerCertFile',
  'egressProxy',
  'bridgeAddress',
  'egressAddress',
  'gatewayAddress',
  'backendAddress',
  'egressInstance',
  'egressImage',
] as const satisfies readonly (keyof LabConfig)[];

export function parseLab(raw: unknown): LabConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('the lab file is not a JSON object');
  }
  const record = new Map(Object.entries(raw));
  const read = (name: (typeof FIELDS)[number]): string => {
    const value = record.get(name);
    if (typeof value !== 'string' || value === '') {
      throw new Error(`the lab file has no ${name}`);
    }
    return value;
  };
  return {
    stateDir: read('stateDir'),
    endpoint: read('endpoint'),
    project: read('project'),
    profile: read('profile'),
    network: read('network'),
    pool: read('pool'),
    acl: read('acl'),
    image: read('image'),
    imageSource: read('imageSource'),
    clientCertFile: read('clientCertFile'),
    clientKeyFile: read('clientKeyFile'),
    serverCertFile: read('serverCertFile'),
    defaultServerCertFile: read('defaultServerCertFile'),
    otherServerCertFile: read('otherServerCertFile'),
    egressProxy: read('egressProxy'),
    bridgeAddress: read('bridgeAddress'),
    egressAddress: read('egressAddress'),
    gatewayAddress: read('gatewayAddress'),
    backendAddress: read('backendAddress'),
    egressInstance: read('egressInstance'),
    egressImage: read('egressImage'),
  };
}

/** The lab file INCUS_E2E_LAB names (lab.sh `env` exports it). */
export function loadLab(path: string | undefined = process.env.INCUS_E2E_LAB) {
  if (path === undefined || path === '') {
    throw new Error(
      'INCUS_E2E_LAB names no lab file: build the lab with e2e/incus/lab.sh first (see e2e/incus/README.md)',
    );
  }
  return parseLab(JSON.parse(readFileSync(path, 'utf8')));
}

export function logDir(lab: LabConfig): string {
  return join(lab.stateDir, 'logs');
}

export function reportDir(lab: LabConfig): string {
  return join(lab.stateDir, 'report');
}
