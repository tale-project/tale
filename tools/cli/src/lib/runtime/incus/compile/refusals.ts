import { CliError, ExitCode } from '../../../../utils/fail';

/**
 * Why the Incus compiler refuses a compose document. A Docker Compose stack
 * that Incus cannot run the same way is refused before anything is made, so
 * no deployment ends up half on one runtime's semantics and half on the
 * other's. Each refusal names its service and compose key, says what it
 * found, and carries a fixed sentence that says why Incus cannot take it.
 */
export const REFUSAL_REASONS = {
  'no-rule':
    'The Incus runtime translates only the compose keys it has a rule for, so a new key cannot run on Docker semantics alone.',
  'refused-key':
    'Incus has no equivalent the stack may use for this compose key.',
  'interpolation-operator':
    'The Incus runtime interpolates ${V}, ${V:-default}, ${V-default}, ${V:?error} and ${V?error} as Docker Compose does, and no other operator.',
  'interpolation-syntax':
    'The value is not a variable reference Docker Compose would read.',
  'variable-required':
    'The compose document requires this variable, and the environment does not set it.',
  'env-file':
    'A service reads its environment only from the deployment .env file.',
  'dotenv-syntax': 'The .env file has a line Docker Compose would not read.',
  'image-facts-missing':
    'The runtime reads every image it runs by digest before it compiles the stack.',
  'platform-mismatch':
    'Incus does not emulate another architecture, so an image must match the server.',
  'object-store-architecture':
    'The bundled object store image exists only for amd64; on another architecture OBJECT_STORE_ENDPOINT must name an external S3 store.',
  'entrypoint-words':
    'Incus splits oci.entrypoint as a shell does, so every word of the command must survive quoting.',
  'healthcheck-missing':
    'The Incus runtime runs each health check itself, so every service declares one or disables it.',
  duration:
    'Durations are written as Docker Compose writes them, such as 30s or 1m30s.',
  size: 'Sizes are written as Docker Compose writes them, such as 512m or 12g.',
  signal: 'The stop signal must be a Linux signal Incus can deliver.',
  'depends-on':
    'A dependency must name a service of the stack, and dependencies may not form a cycle.',
  'bind-mount':
    'Incus mounts only custom volumes; the only host files a service may read are the ones the runtime copies onto a volume.',
  'image-volume-uncovered':
    'The image declares a volume path no compose volume covers, and its data would not survive a restart.',
  'init-missing':
    'A service that holds data must stop through the patched /init, so its process gets its stop signal and its grace.',
  port: 'Incus publishes only the proxy, through the declared ingress.',
  capability:
    'An unprivileged Incus instance holds only the capabilities its user namespace grants.',
  'extra-host':
    'A host entry becomes a name of the stack resolver, so it must name the host gateway or an IPv4 address.',
  network: 'Every instance sits on the one stack bridge.',
  ulimit: 'Incus sets only the kernel limits it knows by name.',
  restart: 'The restart policy must be one Docker Compose defines.',
  placement:
    'Every service of the stack has a fixed address, start order and stop group, and this one has none.',
  replicas:
    'Every role holds at most the address slots of its colour, which is the CLI maximum of 16.',
  'address-block':
    'A workspace needs a /24 address block, which holds two colours, and a managed deployment a /25.',
} as const satisfies Record<string, string>;

export type RefusalId = keyof typeof REFUSAL_REASONS;

export interface Refusal {
  id: RefusalId;
  /** The compose service, or null for the stack as a whole. */
  service: string | null;
  /** The compose key, or null when the refusal is not about one key. */
  key: string | null;
  /** What was found, without any secret value. */
  detail: string;
}

/** A refusal raised where a refusal list is not at hand (interpolation). */
export class RefusalError extends Error {
  readonly refusal: Refusal;
  constructor(item: Refusal) {
    super(describeRefusal(item));
    this.refusal = item;
  }
}

export function refusal(
  id: RefusalId,
  detail: string,
  service: string | null = null,
  key: string | null = null,
): Refusal {
  return { id, service, key, detail };
}

/** `<service>.<key>: <detail>. <reason>` */
function describeRefusal(item: Refusal): string {
  const where = [item.service, item.key].filter(Boolean).join('.');
  return `${where ? `${where}: ` : ''}${item.detail} ${REFUSAL_REASONS[item.id]}`;
}

/** One error that names every refusal of a compile. */
export function refusalsError(refusals: readonly Refusal[]): CliError {
  return new CliError({
    summary: `The stack cannot run on Incus as declared (${refusals.length} ${refusals.length === 1 ? 'refusal' : 'refusals'}).`,
    cause: refusals.map((item) => describeRefusal(item)).join('\n'),
    next: 'Change the compose source or the deployment declaration as each refusal says, or deploy on Docker.',
    code: ExitCode.Precondition,
  });
}
