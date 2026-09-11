import { z } from 'zod/v4';

/**
 * Deployment-level (instance-wide) configuration.
 *
 * Unlike the per-org config files (`<orgSlug>/providers.json`,
 * `<orgSlug>/retention.json`, …), this is a SINGLE deployment-scoped file at
 * the config root (`<configRoot>/deployment.yml`; the retired
 * `deployment.json` stays readable until the next save converts it). It is
 * written by the instance-admin deployment routes and CONSUMED AT BOOT by the
 * sandbox spawner (`services/sandbox/src/config.ts` reads `sandboxRuntime`)
 * — none of it is hot-reloaded. A top-level (one-path-segment) file is
 * intentionally ignored by the per-org config-watcher.
 *
 * WHERE DATA LIVES IS NOT CONFIGURED HERE. The deployment-default stores are
 * environment-driven (`DATABASE_URL`, `KNOWLEDGE_DATABASE_URL`,
 * `OBJECT_STORE_*`), and per-organization residency is its own config lane
 * (`<orgSlug>/knowledge/connection.json`,
 * `<orgSlug>/object-storage/connection.json`). The Convex-era `dataStores`
 * section (knowledgePostgres / appPostgres / convexStorage + a secrets
 * sidecar) was saved but never read by any boot path once the Convex
 * entrypoints retired; it is gone. A file that still carries it is tolerated
 * on read (the section is dropped with a warning) and rewritten without it on
 * the next save — see `parseDeploymentConfig`.
 *
 * The shape is a SECTIONED REGISTRY: `version` + a set of optional sections.
 * Adding a future deployment section is purely additive — add an optional
 * field here; the read/save routes stay section-agnostic (they read/write the
 * whole file).
 */

export const DEPLOYMENT_CONFIG_VERSION = 1 as const;

/**
 * Sections no boot path consumes any more (the Convex-era `dataStores` key).
 * Tolerated by the reader so an operator's older file keeps parsing; never
 * accepted by the strict schema below.
 */
export const RETIRED_DEPLOYMENT_SECTIONS = ['dataStores'] as const;

/**
 * `sandboxRuntime` section — the deployment-wide container runtime tier for the
 * sandbox, uniform across all tenants. `tier` selects the OCI runtime
 * (`runc` default, `gvisor`, `sysbox`, `kata`); `dockerInContainer` enables
 * native `docker`/`docker compose` inside session containers and is only valid
 * on a tier that keeps an isolation boundary (`sysbox`/`kata`) — the spawner
 * fails closed otherwise. `dockerBuildCache` adds a shared, persistent buildkitd
 * + registry mirror so `docker build` / `docker compose up --build` across
 * sessions reuse one build cache (only meaningful with `dockerInContainer`;
 * defaults to ON when `dockerInContainer` is on — set false to opt out). Absent
 * = the `.env`
 * (SANDBOX_RUNTIME / SANDBOX_DOCKER_IN_CONTAINER / SANDBOX_DOCKER_BUILD_CACHE)
 * defaults. Carries no secrets.
 */
const sandboxRuntimeSchema = z
  .object({
    tier: z.enum(['runc', 'gvisor', 'sysbox', 'kata']).optional(),
    dockerInContainer: z.boolean().optional(),
    dockerBuildCache: z.boolean().optional(),
  })
  .strict();

/**
 * Root deployment config. `version` pins the file format (future migrations
 * bump it). Every section is optional so adding a new one never breaks an
 * older file, and an empty `{ version: 1 }` is valid (no overrides → `.env`
 * defaults everywhere).
 */
export const deploymentConfigSchema = z
  .object({
    version: z.literal(DEPLOYMENT_CONFIG_VERSION),
    sandboxRuntime: sandboxRuntimeSchema.optional(),
  })
  .strict();

export type DeploymentConfig = z.infer<typeof deploymentConfigSchema>;
