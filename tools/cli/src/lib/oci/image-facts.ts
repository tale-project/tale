import { z } from 'zod';

import { externalDepError } from '../../utils/fail';
import { AUTOMATION_PROTOCOL_LABEL } from '../deployment/automation-model';
import type { RegistryClient } from './registry';

/**
 * What an image says about itself, read from its registry without Docker: the
 * facts `docker image inspect` gives the managed path today (platform,
 * revision, automation writer protocol) and the ones a runtime other than
 * Docker applies itself (entrypoint, command, environment, user, working
 * directory, stop signal, health check, volumes).
 */

const REVISION_LABEL = 'org.opencontainers.image.revision';
/** The init an image ships at `/init`, by name and version. */
export const TALE_INIT_LABEL = 'dev.tale.init';
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

export interface ImageHealthcheck {
  /** `["CMD", …]`, `["CMD-SHELL", "…"]` or `["NONE"]`, as the image declares it. */
  test: string[];
  /** Milliseconds; null where the image leaves the runtime's default. */
  intervalMs: number | null;
  timeoutMs: number | null;
  startPeriodMs: number | null;
  startIntervalMs: number | null;
  retries: number | null;
}

export interface ImageFacts {
  /** `registry/repository@digest`: the bytes a runtime pulls. */
  reference: string;
  /** What the reference names: the index for a multi-platform image. */
  digest: string;
  manifestDigest: string;
  /** Docker's image ID. */
  configDigest: string;
  os: string;
  architecture: string;
  variant: string | null;
  labels: Record<string, string>;
  /** `org.opencontainers.image.revision`. */
  revision: string | null;
  /** The raw writer protocol label; `imageWriterProtocol` judges it. */
  automationWriterProtocol: string | null;
  /** `dev.tale.init`. */
  init: string | null;
  entrypoint: string[] | null;
  cmd: string[] | null;
  /** `NAME=value` entries, in the image's order. */
  env: string[];
  user: string | null;
  workingDir: string | null;
  stopSignal: string | null;
  healthcheck: ImageHealthcheck | null;
  /** The paths the image declares as volumes, sorted. */
  volumes: string[];
}

const strings = z.array(z.string()).nullable().optional();
const duration = z.number().nonnegative().optional();
const imageConfigSchema = z.object({
  config: z
    .object({
      User: z.string().optional(),
      Env: strings,
      Entrypoint: strings,
      Cmd: strings,
      Volumes: z.record(z.string(), z.unknown()).nullable().optional(),
      WorkingDir: z.string().optional(),
      Labels: z.record(z.string(), z.string()).nullable().optional(),
      StopSignal: z.string().optional(),
      Healthcheck: z
        .object({
          Test: strings,
          Interval: duration,
          Timeout: duration,
          StartPeriod: duration,
          StartInterval: duration,
          Retries: z.number().int().nonnegative().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

/** Docker writes 0 for "not set". */
const milliseconds = (nanoseconds: number | undefined): number | null =>
  nanoseconds ? Math.round(nanoseconds / NANOSECONDS_PER_MILLISECOND) : null;

/** Resolve `reference` for `platform` and read its facts. */
export async function readImageFacts(
  registry: RegistryClient,
  reference: string,
  platform: string,
): Promise<ImageFacts> {
  const image = await registry.resolve(reference, platform);
  const parsed = imageConfigSchema.safeParse(image.config);
  if (!parsed.success)
    throw externalDepError(
      `The image config of ${reference} is no container image config.`,
    );
  const config = parsed.data.config ?? {};
  const labels = config.Labels ?? {};
  const health = config.Healthcheck;
  return {
    reference: image.reference,
    digest: image.digest,
    manifestDigest: image.manifestDigest,
    configDigest: image.configDigest,
    os: image.os,
    architecture: image.architecture,
    variant: image.variant,
    labels,
    revision: labels[REVISION_LABEL] ?? null,
    automationWriterProtocol: labels[AUTOMATION_PROTOCOL_LABEL] ?? null,
    init: labels[TALE_INIT_LABEL] ?? null,
    entrypoint: config.Entrypoint ?? null,
    cmd: config.Cmd ?? null,
    env: config.Env ?? [],
    user: config.User || null,
    workingDir: config.WorkingDir || null,
    stopSignal: config.StopSignal || null,
    healthcheck:
      health?.Test && health.Test.length > 0
        ? {
            test: health.Test,
            intervalMs: milliseconds(health.Interval),
            timeoutMs: milliseconds(health.Timeout),
            startPeriodMs: milliseconds(health.StartPeriod),
            startIntervalMs: milliseconds(health.StartInterval),
            retries: health.Retries || null,
          }
        : null,
    volumes: Object.keys(config.Volumes ?? {}).sort(),
  };
}
