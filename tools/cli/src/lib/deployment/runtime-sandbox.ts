import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import type { ComposeDocument } from './runtime-model';

/**
 * The Incus shape of the sandbox service of a managed runtime.
 *
 * A deployment that declares `sandbox` runs the spawner against an Incus node
 * instead of a Docker socket. `prepareRuntime` turns the release's own
 * `compose.yml` into that shape, `readRuntimeBundle` holds the bundle to it,
 * `applyRuntime` checks the credentials it mounts, its custody accepts the
 * switch between the two shapes, and the managed `.env` drops the names of the
 * shape that is not in use. Everything those need to agree on lives here and
 * nowhere else, so none of them can drift from the others. This module
 * imports no other runtime module at run time: the bundle schema in
 * `runtime-model.ts` is built from the schemas below.
 */

/** The directory of the credentials, beside the `src` directory of the state. */
export const SANDBOX_INCUS_DIRECTORY = 'sandbox-incus';
/** The three PEM files the deployment automation places in that directory. */
export const SANDBOX_INCUS_FILES = [
  'client.crt',
  'client.key',
  'server.crt',
] as const;
/** Where the spawner container sees the directory. */
export const SANDBOX_INCUS_MOUNT_POINT = '/run/secrets/incus';
/**
 * The bind source is relative on purpose: Compose resolves it against the
 * directory of the Compose file, which a managed apply makes `<state>/src`,
 * so it names `<state>/sandbox-incus` without any state path in the YAML.
 */
export const SANDBOX_INCUS_MOUNT_SOURCE = `../${SANDBOX_INCUS_DIRECTORY}`;
export const SANDBOX_INCUS_MOUNT = `${SANDBOX_INCUS_MOUNT_SOURCE}:${SANDBOX_INCUS_MOUNT_POINT}:ro`;

const DOCKER_SOCKET_MOUNT = '/var/run/docker.sock:/var/run/docker.sock';
const SESSION_ROOT_MOUNT = '/var/lib/tale-sandbox:/var/lib/tale-sandbox';
const CONFIG_MOUNT = 'config-data:/app/platform-config:ro';
/** The mounts of the sandbox service in a prepared bundle, by shape. */
const DOCKER_SANDBOX_MOUNTS: readonly string[] = [
  DOCKER_SOCKET_MOUNT,
  SESSION_ROOT_MOUNT,
  CONFIG_MOUNT,
];
const INCUS_SANDBOX_MOUNTS: readonly string[] = [
  SANDBOX_INCUS_MOUNT,
  CONFIG_MOUNT,
];

/** The two shapes a sandbox service has: it drives the Docker socket of the
 * host, or an Incus node through the credentials directory. */
export type SandboxShape = 'docker' | 'incus';
export const SANDBOX_SHAPE_MOUNTS: Record<SandboxShape, readonly string[]> = {
  docker: DOCKER_SANDBOX_MOUNTS,
  incus: INCUS_SANDBOX_MOUNTS,
};
export const otherSandboxShape = (shape: SandboxShape): SandboxShape =>
  shape === 'docker' ? 'incus' : 'docker';
/** The shape a prepared compose file puts the sandbox service in. */
export function sandboxShapeOf(compose: ComposeDocument): SandboxShape {
  return z
    .array(z.string())
    .parse(compose.services.sandbox.volumes ?? [])
    .includes(SANDBOX_INCUS_MOUNT)
    ? 'incus'
    : 'docker';
}

/** A committed file of the spawner that exists only in a revision that has the
 * Incus backend. */
export const INCUS_BACKEND_MARKER =
  'services/sandbox/src/backend/incus/incus-config.ts';

/** The ports the backend API and the LLM gateway answer on, which sessions in
 * Incus dial through the address the deployment declares. */
const BACKEND_API_PORT = 3005;
const LLM_GATEWAY_PORT = 8080;

/** The six variables the Incus shape sets to a literal. */
const LITERAL_VARIABLES = [
  'SANDBOX_BACKEND',
  'SANDBOX_INCUS_IMAGE',
  'SANDBOX_INCUS_IMAGE_SOURCE',
  'SANDBOX_INCUS_CLIENT_CERT_FILE',
  'SANDBOX_INCUS_CLIENT_KEY_FILE',
  'SANDBOX_INCUS_SERVER_CERT_FILE',
] as const;
/** The variables of the Docker shape that the spawner warns about, or
 * refuses, under the Incus backend. */
const REMOVED_VARIABLES = [
  'SANDBOX_RUNTIME',
  'SANDBOX_EGRESS_NETWORK',
  'SANDBOX_HUB_PORT',
] as const;
const EGRESS_PROXY_VARIABLE = 'SANDBOX_EGRESS_PROXY';
/** The ten variables the CLI owns in the Incus shape: a deployment's own
 * `environment` may not name them, and the managed `.env` never keeps them. */
export const SANDBOX_OWNED_VARIABLES: readonly string[] = [
  ...LITERAL_VARIABLES,
  EGRESS_PROXY_VARIABLE,
  ...REMOVED_VARIABLES,
];

const must: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw preconditionError(message);
};

/**
 * A unicast IPv4 address in canonical dotted form: four decimal octets without
 * leading zeros, outside `0.0.0.0/8`, loopback, link-local, multicast and the
 * reserved class that holds the broadcast address.
 */
export function isUnicastIpv4(value: string): boolean {
  const octets =
    /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/.exec(
      value,
    );
  if (!octets) return false;
  const [first, second] = [Number(octets[1]), Number(octets[2])];
  return (
    octets.slice(1).every((octet) => Number(octet) <= 255) &&
    first !== 0 &&
    first !== 127 &&
    !(first === 169 && second === 254) &&
    first < 224
  );
}

/**
 * The spawner's egress proxy under the Incus backend: `http://` with a unicast
 * IPv4 host and an explicit port, and nothing else. A session resolves no name
 * before it reaches the proxy, and a port the URL parser would drop (the
 * scheme's default) or a legacy spelling of the address would not round-trip.
 */
export function isEgressProxy(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    url.protocol === 'http:' &&
    url.origin === value &&
    !url.username &&
    !url.password &&
    isUnicastIpv4(url.hostname) &&
    Number(url.port) >= 1 &&
    Number(url.port) <= 65535
  );
}

const addressSchema = z
  .string()
  .refine(isUnicastIpv4, 'Must be a unicast IPv4 address.');
const egressProxySchema = z
  .string()
  .refine(
    isEgressProxy,
    'Must be http://<unicast IPv4 address>:<port> with an explicit port.',
  );

/** What a deployment declares: the sandbox runs against an Incus node. */
export const sandboxDeclarationSchema = z.strictObject({
  backend: z.literal('incus'),
  address: addressSchema,
  egressProxy: egressProxySchema,
});

/** What the runtime source of a declaring deployment is prepared with. */
export const sandboxPrepareSchema = sandboxDeclarationSchema.omit({
  backend: true,
});
export type SandboxPrepare = z.infer<typeof sandboxPrepareSchema>;

/**
 * What a bundle records: the declaration and the image the spawner starts
 * sessions from on the node. An Incus image alias is at most 64 characters, and
 * one alias names one image because the spawner never pulls an alias that
 * exists, so the alias carries the first 32 digits of the image digest.
 */
export const sandboxBundleSchema = sandboxDeclarationSchema.extend({
  image: z.strictObject({
    alias: z.string().regex(/^tale-sandbox-runtime-[a-f0-9]{32}$/),
    source: z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9.:/-]+\/tale-sandbox-runtime@sha256:[a-f0-9]{64}$/,
      ),
  }),
});
export type SandboxBundle = z.infer<typeof sandboxBundleSchema>;

/** The pinned runtime image the bundle's `sandbox` service starts sessions
 * from: its repository digest reference. */
export interface SandboxRuntimeImage {
  reference: string;
  digest: string;
}

/** The image alias and source the node pulls for a runtime image. */
export function incusImage(image: SandboxRuntimeImage): SandboxBundle['image'] {
  return sandboxBundleSchema.shape.image.parse({
    alias: `tale-sandbox-runtime-${image.digest.replace(/^sha256:/, '').slice(0, 32)}`,
    source: image.reference,
  });
}

/** The record a prepared bundle holds for a declaration. */
export function sandboxBundle(
  declaration: SandboxPrepare,
  image: SandboxRuntimeImage,
): SandboxBundle {
  return sandboxBundleSchema.parse({
    backend: 'incus',
    ...declaration,
    image: incusImage(image),
  });
}

/** The two port lists that publish the services sessions dial. */
export function sandboxPorts(address: string): {
  'backend-api': string[];
  'sandbox-llm-gateway': string[];
} {
  return {
    'backend-api': [`${address}:${BACKEND_API_PORT}:${BACKEND_API_PORT}`],
    'sandbox-llm-gateway': [
      `${address}:${LLM_GATEWAY_PORT}:${LLM_GATEWAY_PORT}`,
    ],
  };
}

/** The six literals of the Incus shape for a bundle's image. */
function literals(sandbox: SandboxBundle): Record<string, string> {
  return {
    SANDBOX_BACKEND: sandbox.backend,
    SANDBOX_INCUS_IMAGE: sandbox.image.alias,
    SANDBOX_INCUS_IMAGE_SOURCE: sandbox.image.source,
    SANDBOX_INCUS_CLIENT_CERT_FILE: `${SANDBOX_INCUS_MOUNT_POINT}/client.crt`,
    SANDBOX_INCUS_CLIENT_KEY_FILE: `${SANDBOX_INCUS_MOUNT_POINT}/client.key`,
    SANDBOX_INCUS_SERVER_CERT_FILE: `${SANDBOX_INCUS_MOUNT_POINT}/server.crt`,
  };
}

const environmentSchema = z.record(z.string(), z.unknown());

/**
 * Turn the sandbox, backend API and LLM gateway services of a prepared Docker
 * bundle into their Incus shape, and hold the result to the reader's rule.
 * The other eight services are not touched.
 */
export function applyIncusShape(
  compose: ComposeDocument,
  sandbox: SandboxBundle,
): void {
  const service = compose.services.sandbox;
  const environment = environmentSchema.parse(service.environment);
  for (const name of [...REMOVED_VARIABLES, EGRESS_PROXY_VARIABLE])
    must(
      environment[name] !== undefined,
      `Runtime sandbox environment lacks ${name}, which the Incus shape replaces; review the source.`,
    );
  for (const name of REMOVED_VARIABLES) delete environment[name];
  environment[EGRESS_PROXY_VARIABLE] = sandbox.egressProxy;
  Object.assign(environment, literals(sandbox));
  service.environment = environment;
  const volumes = z.array(z.string()).parse(service.volumes);
  must(
    [DOCKER_SOCKET_MOUNT, SESSION_ROOT_MOUNT].every((mount) =>
      volumes.includes(mount),
    ),
    'Runtime sandbox mounts differ from the supported Docker shape.',
  );
  service.volumes = [
    SANDBOX_INCUS_MOUNT,
    ...volumes.filter(
      (mount) => mount !== DOCKER_SOCKET_MOUNT && mount !== SESSION_ROOT_MOUNT,
    ),
  ];
  const ports = sandboxPorts(sandbox.address);
  compose.services['backend-api'].ports = ports['backend-api'];
  compose.services['sandbox-llm-gateway'].ports = ports['sandbox-llm-gateway'];
  assertSandboxShape(compose, sandbox, sandbox.image);
}

/**
 * Hold a bundle's compose file to the sandbox shape the bundle records, using
 * only what the bundle holds (the reader never sees the source bytes, so that
 * nothing else changed is the preparation tests' to prove). `image` is the
 * pinned `tale-sandbox-runtime` record the alias and source derive from.
 *
 * Without `sandbox`, no Incus mount, no Incus variable and no published port of
 * the services that sessions dial may be present; every other rule stays with
 * the compose parser, so bundles earlier CLIs prepared still read.
 */
export function assertSandboxShape(
  compose: ComposeDocument,
  sandbox: SandboxBundle | undefined,
  image: SandboxBundle['image'] | undefined,
): void {
  const service = compose.services.sandbox;
  const environment = environmentSchema.parse(service.environment);
  const volumes = z.array(z.string()).parse(service.volumes ?? []);
  if (sandbox === undefined) {
    must(
      Object.values(compose.services).every(
        (other) =>
          !z
            .array(z.string())
            .parse(other.volumes ?? [])
            .includes(SANDBOX_INCUS_MOUNT),
      ),
      'Runtime bundle mounts Incus credentials without declaring the Incus sandbox.',
    );
    must(
      environment.SANDBOX_BACKEND !== 'incus' &&
        LITERAL_VARIABLES.filter((name) => name !== 'SANDBOX_BACKEND').every(
          (name) => environment[name] === undefined,
        ),
      'Runtime bundle sets the Incus backend without declaring the Incus sandbox.',
    );
    return;
  }
  must(
    image !== undefined &&
      image.alias === sandbox.image.alias &&
      image.source === sandbox.image.source,
    'Runtime sandbox image differs from the pinned runtime image.',
  );
  must(
    JSON.stringify(volumes) === JSON.stringify(INCUS_SANDBOX_MOUNTS),
    'Runtime sandbox mounts differ from the Incus shape.',
  );
  const expected = literals(sandbox);
  must(
    Object.entries(expected).every(
      ([name, value]) => environment[name] === value,
    ) &&
      environment[EGRESS_PROXY_VARIABLE] === sandbox.egressProxy &&
      REMOVED_VARIABLES.every((name) => environment[name] === undefined),
    'Runtime sandbox environment differs from the Incus shape.',
  );
  const ports = sandboxPorts(sandbox.address);
  must(
    JSON.stringify(compose.services['backend-api'].ports) ===
      JSON.stringify(ports['backend-api']) &&
      JSON.stringify(compose.services['sandbox-llm-gateway'].ports) ===
        JSON.stringify(ports['sandbox-llm-gateway']) &&
      JSON.stringify(service.ports ?? []) === '[]',
    'Runtime published ports differ from the Incus shape.',
  );
}
