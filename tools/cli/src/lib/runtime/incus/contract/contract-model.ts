import { z } from 'zod';

/**
 * The node contract (design D-31): what an Incus server must hold before a
 * Tale stack can run on it, as data an operator (or `tale incus bootstrap`)
 * applies and `tale incus check` reads back. Ops reads it in CI from the
 * pinned CLI and makes the project, the bridge, the ACLs and the trust from
 * it, so it never encodes Tale's services or ports itself.
 *
 * The document is versioned and additive: `schemaVersion` 1 only ever gains
 * fields. A reader keeps what it does not know (`looseObject`), so an older
 * reader of a newer contract still reads the fields it knows, and a field
 * that changes meaning is a new schema version, never an edit.
 */

export const CONTRACT_SCHEMA_VERSION = 1;
export const CONTRACT_KIND = 'tale.incus.node-contract';

const port = z.number().int().min(1).max(65535);

/** One allow rule of an Incus network ACL. Addresses are CIDRs; an absent
 * side means any address. */
export const contractRuleSchema = z.looseObject({
  /** Stable within a schema version: a test and an operator name it. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** `stack`: the ACL on the app bridge; `sessions`: the sandbox zone's. */
  acl: z.enum(['stack', 'sessions']),
  /** As Incus sees it from the instances on that bridge. */
  direction: z.enum(['egress', 'ingress']),
  source: z.array(z.string()).optional(),
  destination: z.array(z.string()).optional(),
  protocol: z.enum(['tcp', 'udp']).optional(),
  ports: z.array(port).optional(),
  purpose: z.string(),
  /**
   * What `tale incus check` does with the rule: `probe` judges it by a
   * helper's connection from the app bridge; `listed` names it for an
   * operator who enforces it elsewhere, and check expects nothing of it
   * (traffic on the bridge itself and to its DNS passes without a rule,
   * design R3-10; traffic from the sessions or the internet cannot be sent
   * from the stack's side).
   */
  check: z.enum(['probe', 'listed']),
});
export type ContractRule = z.infer<typeof contractRuleSchema>;

const configMap = z.record(z.string(), z.string());

export const nodeContractSchema = z.looseObject({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  kind: z.literal(CONTRACT_KIND),
  /** `workspace` (two colours, a /24) or `managed` (in place, a /25). */
  path: z.enum(['workspace', 'managed']),
  /** `user.tale.stack`. */
  stack: z.string(),
  /** The API extensions the server must have, by name (design D-06). */
  extensions: z.array(z.string()),
  server: z.looseObject({
    clustered: z.literal(false),
    idmappedMounts: z.literal(true),
    /** The oldest OpenZFS a ZFS pool may run (idmapped mounts). */
    minimumZfs: z.string(),
  }),
  project: z.looseObject({
    name: z.string(),
    /** `features.*`, `restricted.*` and the computed `limits.*`. */
    config: configMap,
  }),
  /** The profile every stack instance is made with (design 5.1, R3-12). */
  profile: z.looseObject({
    name: z.string(),
    config: configMap,
    devices: z.record(z.string(), configMap),
  }),
  /** The app bridge: an admin object the operator makes (design D-15). */
  network: z.looseObject({
    name: z.string(),
    type: z.literal('bridge'),
    subnet: z.string(),
    gateway: z.string(),
    /** The addresses the CLI assigns; DHCP never hands one of them out. */
    block: z.string(),
    config: configMap,
  }),
  acls: z.looseObject({
    /** The ACL the app bridge carries (`security.acls`). */
    stack: z.string(),
    /** The ACL the sandbox zone's bridge carries. */
    sessions: z.string(),
    rules: z.array(contractRuleSchema),
  }),
  sessions: z.looseObject({
    subnet: z.string(),
    /** Where the sessions' egress goes: the declared proxy, else the
     * stack's own `sandbox-egress` (design R-13). */
    egressProxy: z.string(),
  }),
  storage: z.looseObject({
    pool: z.string(),
    rootSize: z.string(),
    volumes: z.array(
      z.looseObject({
        name: z.string(),
        kind: z.enum(['data', 'runtime']),
        size: z.string().optional(),
        config: configMap,
      }),
    ),
  }),
  /** The peak the project limits are computed for. */
  peak: z.looseObject({
    description: z.string(),
    instances: z.number().int(),
    memoryBytes: z.number().int(),
    processes: z.number().int(),
    /** Root disks plus declared volume sizes; null while a volume has no
     * declared size (then the pool limit is left out). */
    diskBytes: z.number().int().nullable(),
    /** Image versions the project holds at once during an upgrade. */
    imageVersions: z.number().int(),
  }),
  /** The registry hosts the project pulls from, exactly as the CLI's remote
   * URLs carry them (`restricted.images.servers`, design R3-12). */
  registries: z.array(z.string()),
  /** The certificate the CLI presents: restricted to the stack project. */
  certificate: z.looseObject({
    name: z.string(),
    type: z.literal('client'),
    restricted: z.literal(true),
    projects: z.array(z.string()),
  }),
  /** Tale's `boot.stop.priority` groups and the band other projects stay
   * out of (design D-23, R3-28). */
  stopPriorities: z.looseObject({
    groups: z.looseObject({
      edge: z.number().int(),
      middle: z.number().int(),
      data: z.number().int(),
    }),
    reservedBand: z.looseObject({
      from: z.number().int(),
      to: z.number().int(),
    }),
    /** How long data services wait for their signal on host shutdown. */
    dataSignalWithinSeconds: z.number().int(),
    boundHolds: z.string(),
  }),
  ingress: z.looseObject({
    mode: z.enum(['routed', 'proxy-device']),
    listen: z.string().optional(),
    proxy: z.string(),
    ports: z.array(port),
  }),
  /** Things the contract states but cannot encode as a setting. */
  notes: z.array(z.string()),
});
export type NodeContract = z.infer<typeof nodeContractSchema>;

/** A contract this CLI can read: one of schema version 1, whatever fields a
 * newer CLI added. */
export function parseNodeContract(value: unknown): NodeContract {
  return nodeContractSchema.parse(value);
}
