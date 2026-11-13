import { z } from 'zod';

import { sha } from '../../../config/releases/model';

/**
 * The plan of an Incus stack (design D-07, D-13): what one apply will do to
 * each resource, as digests and revisions only. Like the native
 * configuration plan (`configurationPlanSchema`) it is strict and holds no
 * value, so it can be saved, reviewed in CI and applied later: a digest is
 * keyed (D-11), and an instance's environment never appears in it.
 */

export const INCUS_PLAN_ACTIONS = [
  'create',
  'replace',
  'update',
  'delete',
  'unchanged',
  // A change the plan leaves for later on purpose: a stop-gated instance
  // keeps running what it runs until a deploy with --stop (R-02).
  'deferred',
] as const;

/** What an action costs beyond the resource itself; each is a gate. */
export const INCUS_PLAN_EFFECTS = [
  // A running stop-gated instance stops: needs --stop (or a first deploy).
  'downtime',
  // The spawner is drained before it is replaced.
  'drain-sandbox',
  // A backend replica is drained before it is replaced or deleted.
  'drain-backend',
  // A data volume is made empty: needs `tale restore` or `tale reset`.
  'data',
  // The stack's names change (a resolver or its records).
  'names',
  // The traffic switch is made or replaced.
  'switch',
] as const;
export type IncusPlanEffect = (typeof INCUS_PLAN_EFFECTS)[number];

/** Which part of the stack a plan covers (design 7.2's scopes). */
export const INCUS_PLAN_PHASES = [
  'full',
  'infrastructure',
  'stateful',
  'colour-blue',
  'colour-green',
] as const;
export type IncusPlanPhase = (typeof INCUS_PLAN_PHASES)[number];

export const INCUS_RESOURCE_KINDS = [
  'image',
  'volume',
  'file',
  'instance',
  'ingress',
] as const;
export type IncusResourceKind = (typeof INCUS_RESOURCE_KINDS)[number];

const RESOURCES_MAX = 1024;
const INCUS_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

export const incusDestinationSchema = z.strictObject({
  /** The Incus API the plan was read from. */
  endpoint: z.string().url().max(2048),
  /** The pinned server certificate, by its SHA-256. */
  serverCertificateSha256: sha,
  project: z.string().regex(INCUS_NAME),
  pool: z.string().regex(INCUS_NAME),
  architecture: z.string().min(1).max(32),
});
export type IncusDestination = z.infer<typeof incusDestinationSchema>;

export const incusPlanResourceSchema = z.strictObject({
  /** `<kind>/<name>`: `instance/db`, `file/names-config/stack/hosts`. */
  id: z
    .string()
    .min(3)
    .max(1024)
    .regex(/^(image|volume|file|instance|ingress)\/[^\s]+$/),
  currentSha256: sha,
  desiredSha256: sha,
  /** The ETag the resource was read with, where Incus gives one. */
  revision: z.string().max(200).nullable(),
  action: z.enum(INCUS_PLAN_ACTIONS),
  effects: z.array(z.enum(INCUS_PLAN_EFFECTS)).max(INCUS_PLAN_EFFECTS.length),
  /** A fixed sentence on what a deferred or gated action waits for. */
  hint: z.string().min(1).max(400).optional(),
});
export type IncusPlanResource = z.infer<typeof incusPlanResourceSchema>;

export const incusPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** The keyed digest of the compiled target and the files it writes. */
  targetSha256: sha,
  phase: z.enum(INCUS_PLAN_PHASES),
  destination: incusDestinationSchema,
  /** In the order the applier converges them. */
  resources: z.array(incusPlanResourceSchema).max(RESOURCES_MAX),
});
export type IncusPlan = z.infer<typeof incusPlanSchema>;

export function resourceId(kind: IncusResourceKind, name: string): string {
  return `${kind}/${name}`;
}

/** The kind and name of a resource id. */
export function parseResourceId(id: string): {
  kind: IncusResourceKind;
  name: string;
} {
  const slash = id.indexOf('/');
  const kind = id.slice(0, slash);
  if (!(INCUS_RESOURCE_KINDS as readonly string[]).includes(kind))
    throw new Error(`Not an Incus plan resource: ${id}`);
  return { kind: kind as IncusResourceKind, name: id.slice(slash + 1) };
}

/** True when the plan changes nothing. */
export function isEmptyPlan(plan: IncusPlan): boolean {
  return plan.resources.every(
    (resource) =>
      resource.action === 'unchanged' || resource.action === 'deferred',
  );
}
