import { randomBytes } from 'node:crypto';

import { startInstance, stopInstance } from '@tale/incus/state';

import { preconditionError } from '../../../../utils/fail';
import type { ExecResult, OneShotJob } from '../../types';
import {
  DEFAULT_EXEC_TIMEOUT_S,
  execInInstance,
  type IncusVerbContext,
} from './exec';
import { STACK_PROFILE } from './probe';

/**
 * One-shot helper jobs on Incus (design D-30): what Docker runs as
 * `docker run --rm alpine:3.22 …` runs in a helper instance made from the
 * release's `tale-proxy` image, which the project holds already and which
 * carries busybox `tar`, `gzip` and `sha256sum` — no pull from Docker Hub,
 * no new pin.
 *
 * The helper is `job-<purpose>-<8 hex>`, labelled `user.tale.role=helper`
 * (no census counts it, and the next run reaps one a crash left), with the
 * job's volumes attached, no network device, and `sleep` as its entrypoint.
 * The job's command runs by exec, which gives its exit code (Incus keeps
 * none for a stopped instance); then the helper is deleted.
 */

const HELPER_ROLE = 'helper';
const WAIT_MS = 120_000;
/** How long a helper outlives its job's own deadline at most. */
const HELPER_SLACK_S = 300;
const PURPOSE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The helper instance's name for `purpose`. */
export function helperName(purpose = 'job'): string {
  if (!PURPOSE.test(purpose))
    throw new Error(
      `Not a job purpose: ${JSON.stringify(purpose)} (lower-case letters, digits and dashes).`,
    );
  return `job-${purpose}-${randomBytes(4).toString('hex')}`;
}

/** The helper's devices: each job volume, and no network device (the
 * `tale-stack` profile carries none, design 5.1; a `none` device that would
 * mask one is a device type the restricted project blocks). */
export function helperDevices(
  pool: string,
  job: Pick<OneShotJob, 'mounts'>,
): Record<string, Record<string, string>> {
  const devices: Record<string, Record<string, string>> = {};
  for (const [index, mount] of job.mounts.entries())
    devices[`job-volume-${index}`] = {
      type: 'disk',
      pool,
      source: mount.volume,
      path: mount.target,
      ...(mount.readOnly === true ? { readonly: 'true' } : {}),
    };
  return devices;
}

/** Delete the stack's helpers that `active` does not name: a crash left
 * them. */
export async function reapHelpers(
  context: IncusVerbContext,
  active: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const reaped: string[] = [];
  for (const instance of await context.client.listInstances()) {
    if (
      instance.config['user.tale.role'] !== HELPER_ROLE ||
      instance.config['user.tale.stack'] !== context.stack ||
      active.has(instance.name)
    )
      continue;
    await removeHelper(context, instance.name, instance.status);
    reaped.push(instance.name);
  }
  return reaped;
}

async function removeHelper(
  context: IncusVerbContext,
  name: string,
  status?: string,
): Promise<void> {
  if (status !== 'Stopped')
    await stopInstance(context.client, name, {
      timeoutSeconds: 0,
      force: true,
    }).catch((error: unknown) => {
      // A helper already stopped refuses the stop; the delete says the rest.
      console.warn(
        `The helper ${name} did not stop:`,
        error instanceof Error ? error.message : error,
      );
    });
  await context.client.deleteInstance(name, WAIT_MS);
}

/**
 * Run `job` in a helper made from `image` (the release's `tale-proxy` alias)
 * over its volumes on `pool`, and delete the helper. `active` holds the
 * helpers running in this process, so a parallel job's reap spares them.
 */
export async function runOneShot(
  context: IncusVerbContext,
  job: OneShotJob,
  helper: {
    /** The `tale-proxy` alias in the project, and its digest. */
    image: string;
    digest?: string;
    pool: string;
    active: Set<string>;
  },
): Promise<ExecResult> {
  if (job.argv.length === 0)
    throw preconditionError('A one-shot job needs a command.');
  const timeoutS = job.timeoutS ?? DEFAULT_EXEC_TIMEOUT_S;
  const name = helperName(job.purpose);
  helper.active.add(name);
  try {
    await reapHelpers(context, helper.active);
    await context.client.createInstance(
      {
        name,
        ephemeral: false,
        profiles: [STACK_PROFILE],
        config: {
          'security.idmap.isolated': 'true',
          'oci.entrypoint': `sleep ${Math.ceil(timeoutS) + HELPER_SLACK_S}`,
          'user.tale.stack': context.stack,
          'user.tale.role': HELPER_ROLE,
          'user.tale.purpose': job.purpose ?? 'job',
          // The image facts name its `timeout`, so the job runs in mode 2.
          ...(helper.digest === undefined
            ? {}
            : { 'user.tale.image': helper.digest }),
        },
        devices: helperDevices(helper.pool, job),
        source: { type: 'image', alias: helper.image },
        start: false,
      },
      WAIT_MS,
    );
    await startInstance(context.client, name);
    return await execInInstance(context, name, job.argv, {
      timeoutS,
      ...(job.stdin === undefined ? {} : { stdin: job.stdin }),
    });
  } finally {
    try {
      if ((await context.client.getInstance(name)) !== undefined)
        await removeHelper(context, name);
    } catch (error) {
      console.warn(
        `The helper ${name} could not be deleted; the next job reaps it:`,
        error instanceof Error ? error.message : error,
      );
    }
    helper.active.delete(name);
  }
}
