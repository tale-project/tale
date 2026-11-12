import type { SingletonRole, SlotRole } from './address-plan';

/**
 * Where each service of the stack sits on Incus (design 6, D-22, D-23):
 * its address, its start priority, its stop group, whether it may run without
 * the patched `/init`, and the limits it gets when its compose service sets
 * none.
 *
 * Start priorities keep design 6's order (Incus starts the highest first).
 * Stop priorities are three groups (r3: R3-05), because a host shutdown stops
 * one `boot.stop.priority` group at a time, each for up to 30 s:
 *
 * - 90: the edge and the colours, stopped first;
 * - 50: the middle tier;
 * - 10: data and the resolvers, stopped last.
 *
 * `placement-parity.test.ts` holds the service rows to the services of every
 * generated compose document and of the repository's `compose.yml`: a service
 * without a row, or a row without a service, fails it.
 */

export const STOP_GROUPS = { edge: 90, middle: 50, data: 10 } as const;
export type StopGroup = (typeof STOP_GROUPS)[keyof typeof STOP_GROUPS];

export interface InstanceLimits {
  /** `limits.memory`, as Incus takes it (`4GiB`). */
  memory: string;
  /** `limits.processes`. */
  processes: number;
}

/**
 * The `tale-stack` profile's defaults (r3: R3-12). When a project sets
 * `limits.memory` and `limits.processes`, Incus refuses an instance without
 * them, so every instance carries both: its compose value, else its row's,
 * else these.
 */
export const PROFILE_LIMITS: InstanceLimits = {
  memory: '2GiB',
  processes: 2048,
};

export interface PlacementRow {
  /** A compose service, or an instance the runtime adds (resolvers, switch). */
  kind: 'service' | 'infrastructure';
  address: { singleton: SingletonRole } | { slot: SlotRole };
  /** `boot.autostart.priority`: the highest starts first. */
  start: number;
  /** `boot.stop.priority`: the highest group stops first. */
  stop: StopGroup;
  /** Why the service may run on an image without the patched `/init`
   * (design D-22). Absent: a service that holds a volume needs it. */
  acceptedWithoutInit?: string;
  /** Limits beyond the profile's, for a service its compose source leaves
   * unbounded but the profile would starve. */
  limits?: Partial<InstanceLimits>;
}

export const PLACEMENT = {
  names: {
    kind: 'infrastructure',
    address: { singleton: 'names' },
    start: 100,
    stop: STOP_GROUPS.data,
    limits: { memory: '256MiB', processes: 256 },
  },
  'names-sessions': {
    kind: 'infrastructure',
    address: { singleton: 'names-sessions' },
    start: 100,
    stop: STOP_GROUPS.data,
    limits: { memory: '256MiB', processes: 256 },
  },
  db: {
    kind: 'service',
    address: { singleton: 'db' },
    start: 90,
    stop: STOP_GROUPS.data,
    limits: { memory: '8GiB', processes: 4096 },
  },
  'knowledge-db': {
    kind: 'service',
    address: { singleton: 'knowledge-db' },
    start: 90,
    stop: STOP_GROUPS.data,
    limits: { memory: '8GiB', processes: 4096 },
  },
  'object-store': {
    kind: 'service',
    address: { singleton: 'object-store' },
    start: 80,
    stop: STOP_GROUPS.data,
    acceptedWithoutInit:
      'the pinned MinIO image is built by ops, and every writer of the store stops before it',
  },
  'sandbox-egress': {
    kind: 'service',
    address: { singleton: 'sandbox-egress' },
    start: 70,
    stop: STOP_GROUPS.middle,
  },
  'sandbox-llm-gateway': {
    kind: 'service',
    address: { singleton: 'sandbox-llm-gateway' },
    start: 60,
    stop: STOP_GROUPS.middle,
  },
  sandbox: {
    kind: 'service',
    address: { singleton: 'sandbox' },
    start: 50,
    stop: STOP_GROUPS.middle,
  },
  switch: {
    kind: 'infrastructure',
    address: { singleton: 'switch' },
    start: 45,
    stop: STOP_GROUPS.edge,
    limits: { memory: '1GiB' },
  },
  platform: {
    kind: 'service',
    address: { slot: 'platform' },
    start: 40,
    stop: STOP_GROUPS.edge,
    limits: { memory: '4GiB' },
  },
  'backend-api': {
    kind: 'service',
    address: { slot: 'backend-api' },
    start: 40,
    stop: STOP_GROUPS.edge,
    // The generated compose's own bounds (create-backend-services.ts), which
    // the repository's compose.yml leaves out.
    limits: { memory: '12GiB', processes: 4096 },
  },
  'backend-worker': {
    kind: 'service',
    address: { slot: 'backend-worker' },
    start: 40,
    stop: STOP_GROUPS.edge,
    // The generated compose's own bounds (create-backend-services.ts), which
    // the repository's compose.yml leaves out.
    limits: { memory: '12GiB', processes: 4096 },
  },
  'bgutil-provider': {
    kind: 'service',
    address: { singleton: 'bgutil-provider' },
    start: 20,
    stop: STOP_GROUPS.middle,
    acceptedWithoutInit:
      'a third-party sidecar that holds no data and may stop at once',
    // As create-bgutil-provider-service.ts bounds it.
    limits: { memory: '512MiB', processes: 512 },
  },
  proxy: {
    kind: 'service',
    address: { singleton: 'proxy' },
    start: 10,
    stop: STOP_GROUPS.edge,
    limits: { memory: '1GiB' },
  },
} as const satisfies Record<string, PlacementRow>;

export function placementOf(name: string): PlacementRow | undefined {
  return Object.hasOwn(PLACEMENT, name)
    ? (PLACEMENT as Record<string, PlacementRow>)[name]
    : undefined;
}

/** The rows of compose services, which the parity guard holds. */
export function servicePlacementNames(): string[] {
  return Object.entries(PLACEMENT as Record<string, PlacementRow>)
    .filter(([, row]) => row.kind === 'service')
    .map(([name]) => name)
    .sort();
}
