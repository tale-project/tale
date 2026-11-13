/**
 * The translator's table (design 6.1, D-09): every compose service key has
 * exactly one rule. `map` carries it onto the instance, `ignore` drops it for
 * the recorded reason, `refuse` stops the compile. A key without a row is
 * refused too, and `rules-coverage.test.ts` fails on a `ComposeService` key
 * (`lib/compose/types.ts`) without a row, so a new compose key cannot ship on
 * Docker semantics alone.
 */

export type RuleAction = 'map' | 'ignore' | 'refuse';

export interface Rule {
  action: RuleAction;
  /** What the key becomes on Incus, or why it is dropped or refused. */
  rule: string;
}

export const RULES = {
  image: {
    action: 'map',
    rule: 'the instance runs the image by digest, under an alias named after its repository and digest',
  },
  platform: {
    action: 'map',
    rule: 'must equal the server architecture; the bundled object store on another one is left out only when OBJECT_STORE_ENDPOINT names an external store',
  },
  container_name: {
    action: 'ignore',
    rule: 'a singleton instance is named after its service, since the Incus project already namespaces the stack',
  },
  init: {
    action: 'ignore',
    rule: 'the patched /init, or lxc-init for an accepted image, reaps child processes',
  },
  pull_policy: {
    action: 'ignore',
    rule: 'images are always pulled by digest',
  },
  command: {
    action: 'map',
    rule: 'replaces the image command after /init in oci.entrypoint, shell-quoted',
  },
  entrypoint: {
    action: 'map',
    rule: 'replaces the image entrypoint after /init in oci.entrypoint, shell-quoted',
  },
  stop_grace_period: {
    action: 'map',
    rule: 'the stop timeout and user.tale.grace',
  },
  stop_signal: {
    action: 'map',
    rule: 'the signal /init sends for the Incus halt signals (--rewrite), and user.tale.signal',
  },
  shm_size: {
    action: 'map',
    rule: 'TALE_SHM_SIZE, which the tale-db entrypoint mounts as /dev/shm',
  },
  ports: {
    action: 'map',
    rule: "the proxy's 80 and 443 through the declared ingress; the managed database's loopback publishes and the Docker sandbox shape's published ports are dropped, since the stack reaches them by address; anything else is refused",
  },
  volumes: {
    action: 'map',
    rule: 'a named volume becomes a disk device on the custom volume (:ro read-only); the bundle Caddyfile and the spawner credentials become runtime-owned volumes; the Docker socket and the session root are dropped with the Incus sandbox shape; any other bind is refused',
  },
  env_file: {
    action: 'map',
    rule: 'the keys of .env, read with Docker Compose grammar, under the instance environment; required: false is honoured',
  },
  environment: {
    action: 'map',
    rule: "environment.* after interpolation, over the env_file keys, over the image config's Env (Incus would apply the config of another image with the same layers)",
  },
  restart: {
    action: 'map',
    rule: 'boot.autorestart (no: false), with the instance left in its last state',
  },
  healthcheck: {
    action: 'map',
    rule: "the runtime's health engine runs it by exec; every service declares one or disables it",
  },
  depends_on: {
    action: 'map',
    rule: 'the start order and its health gates; an unknown service or a cycle is refused',
  },
  logging: {
    action: 'ignore',
    rule: 'Incus keeps the console log of the instance',
  },
  networks: {
    action: 'map',
    rule: 'one NIC on the stack bridge with a static address; aliases become names of the stack resolver',
  },
  extra_hosts: {
    action: 'map',
    rule: 'names of the stack resolver; host-gateway is the bridge gateway',
  },
  cap_add: {
    action: 'map',
    rule: 'allowed only for capabilities the user namespace already grants (NET_ADMIN, NET_BIND_SERVICE, CHOWN, SETUID, SETGID, DAC_OVERRIDE, KILL)',
  },
  cap_drop: {
    action: 'ignore',
    rule: 'Incus cannot drop capabilities without raw.lxc; the egress narrows its bounding set itself with setpriv',
  },
  sysctls: { action: 'map', rule: 'linux.sysctl.*' },
  mem_limit: { action: 'map', rule: 'limits.memory' },
  pids_limit: { action: 'map', rule: 'limits.processes' },
  ulimits: { action: 'map', rule: 'limits.kernel.<name> as soft:hard' },
  security_opt: {
    action: 'refuse',
    rule: 'Incus takes no per-instance security options in a restricted project',
  },
  runtime: {
    action: 'refuse',
    rule: 'an Incus instance has no OCI runtime to choose',
  },
  build: {
    action: 'refuse',
    rule: 'Incus runs released images by digest and builds nothing',
  },
  network_mode: {
    action: 'refuse',
    rule: 'every instance sits on the stack bridge',
  },
  privileged: {
    action: 'refuse',
    rule: 'the stack project admits isolated containers only',
  },
} as const satisfies Record<string, Rule>;

export function ruleOf(key: string): Rule | undefined {
  return Object.hasOwn(RULES, key)
    ? (RULES as Record<string, Rule>)[key]
    : undefined;
}
