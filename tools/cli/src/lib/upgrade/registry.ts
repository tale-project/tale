import { adoptConvexStatefulMigration } from './migrations/adopt-convex-stateful';
import { namespaceCaddyConfigMigration } from './migrations/namespace-caddy-config';
import { namespaceVolumesMigration } from './migrations/namespace-volumes';
import { splitConvexMigration } from './migrations/split-convex';
import type { Migration } from './types';

/**
 * Ordered registry of all known upgrade steps.
 *
 * This is NOT a per-release changelog — each entry is a one-shot data
 * migration the CLI knows how to apply. Steps are idempotent (gated by
 * detect()), so the registry only grows when a release actually needs to
 * mutate user state on the host (Docker volumes, on-disk files, …).
 *
 * Order matters: each entry may assume every earlier entry has run (or
 * reported "nothing to do" via detect()). Never reorder; only append.
 */
export const MIGRATIONS: readonly Migration[] = [
  namespaceVolumesMigration, // v0.2.33 — rename tale_* → ${projectId}_*
  splitConvexMigration, // v0.3.0  — platform-data → convex-data
  namespaceCaddyConfigMigration, // v0.3.1  — fix: caddy-config missed by namespace-volumes
  adoptConvexStatefulMigration, // v0.3.1  — convex from color→stateful project
];
