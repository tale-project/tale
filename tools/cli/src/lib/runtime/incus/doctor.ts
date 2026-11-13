import { X509Certificate } from 'node:crypto';

import { IncusClient, type IncusTlsMaterial } from '@tale/incus/client';

import { CliError } from '../../../utils/fail';
import type { SetupCheck } from '../../docker/setup-checks';
import type { IncusDeclaration } from './compile/stack-target';
import { readIncusCredentials, workspaceIncusDirectory } from './credentials';
import { crashReport, stoppedAfterCrashes } from './verbs/logs';
import { probeIncus } from './verbs/probe';

/**
 * What `tale doctor` checks of a workspace that declares the Incus runtime
 * (design D-24, D-35, R-09, R3-07):
 *
 * - `incus-credentials`: the certificate the CLI presents and the server
 *   certificate it pins, from files alone (custody, a pinnable server
 *   certificate, the key that belongs to the certificate, expiry);
 * - `incus-api`: the probe of the server, the project, the stack profile
 *   and the pool, with the stack's restricted certificate. The registries
 *   the project must allow are `tale incus check`'s, which reads the whole
 *   node contract;
 * - `incus-instances`: each instance of the stack that Incus stopped after
 *   repeated crashes, with the console it kept. Only a stopped instance's
 *   console is read; a running console hands each line out once, and a
 *   doctor never takes them.
 *
 * Offline, nothing is sent over the network: the API rows say they were
 * skipped.
 */

/** A doctor row; `lines` are shown under it (a crashed instance's console). */
export interface DoctorCheck extends SetupCheck {
  lines?: string[];
}

export interface IncusDoctorOptions {
  /** The workspace directory, where `.tale/incus/` lives. */
  projectDir: string;
  /** `user.tale.stack`: the workspace's project id. */
  stack: string;
  declaration: IncusDeclaration;
  /** Make no network call. */
  offline: boolean;
  environment?: NodeJS.ProcessEnv;
  nowMs?: number;
  /** The API client for the credentials read; over mutual TLS to the
   * declared endpoint by default (tests pass a fake's). */
  connect?: (tls: IncusTlsMaterial, endpoint: string) => IncusClient;
}

/** A certificate this close to its end is reported, as the reader warns. */
const EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1000;
/** The console lines a crash report shows. */
const CRASH_TAIL_LINES = 20;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The API the CLI dials, as the declaration names it. */
function incusEndpointOf(declaration: IncusDeclaration): string {
  return declaration.endpoint ?? `https://${declaration.network.gateway}:8443`;
}

function connectOverTls(
  tls: IncusTlsMaterial,
  endpoint: string,
  project: string,
) {
  return new IncusClient({
    endpoint,
    project,
    tls,
    signal: () => undefined,
  });
}

async function credentialsCheck(
  directory: string,
  nowMs: number,
): Promise<{ check: DoctorCheck; tls: IncusTlsMaterial | null }> {
  let tls: IncusTlsMaterial;
  try {
    tls = await readIncusCredentials(directory, nowMs);
  } catch (error) {
    const next = error instanceof CliError ? error.info.next : undefined;
    return {
      tls: null,
      check: {
        id: 'incus-credentials',
        status: 'fail',
        detail: message(error),
        fix:
          (Array.isArray(next) ? next.join(' ') : next) ??
          'Run tale incus bootstrap on the Incus host, or copy client.crt, client.key and server.crt (mode 0600) into the directory.',
      },
    };
  }
  const validTo = new X509Certificate(tls.cert).validTo;
  const left = new Date(validTo).getTime() - nowMs;
  const expiring = Number.isFinite(left) && left < EXPIRY_WARNING_MS;
  return {
    tls,
    check: {
      id: 'incus-credentials',
      status: expiring ? 'warn' : 'ok',
      detail: `Incus credentials in ${directory}: the client certificate is valid until ${validTo}, and the server certificate can be pinned.`,
      ...(expiring
        ? {
            fix: 'Renew the client certificate before then, and trust the new one in the stack project.',
          }
        : {}),
    },
  };
}

const ONE_OFF_ROLES = new Set(['helper', 'probe']);

async function instanceChecks(
  client: IncusClient,
  options: IncusDoctorOptions,
): Promise<DoctorCheck[]> {
  const instances = (await client.listInstances()).filter(
    (instance) =>
      instance.config['user.tale.stack'] === options.stack &&
      !ONE_OFF_ROLES.has(instance.config['user.tale.role'] ?? ''),
  );
  const crashed = instances.filter((instance) =>
    stoppedAfterCrashes(instance.status, instance.config),
  );
  const checks: DoctorCheck[] = [];
  for (const instance of crashed) {
    // crashReport reads the console only while the instance is stopped.
    const report = await crashReport(
      { client, stack: options.stack, stateRoot: options.projectDir },
      instance.name,
      CRASH_TAIL_LINES,
    );
    if (report === null) continue;
    checks.push({
      id: 'incus-instances',
      status: 'fail',
      detail: `${instance.name} ${report.status}: Incus restarts an instance up to 10 times in a minute, then leaves it stopped.`,
      fix: `Fix what its console shows, then start it again: incus start ${instance.name} --project ${options.declaration.project}`,
      lines: [
        `${report.tail.label}:`,
        ...(report.tail.lines.length === 0 ? ['(none)'] : report.tail.lines),
      ],
    });
  }
  if (checks.length === 0)
    checks.push({
      id: 'incus-instances',
      status: 'ok',
      detail:
        instances.length === 0
          ? `Stack ${options.stack} has no instances in project ${options.declaration.project} yet.`
          : `None of the ${instances.length} instances of stack ${options.stack} stopped after repeated crashes.`,
    });
  return checks;
}

/** The doctor rows of an Incus workspace, in the order they are shown. */
export async function collectIncusChecks(
  options: IncusDoctorOptions,
): Promise<DoctorCheck[]> {
  const { declaration } = options;
  const endpoint = incusEndpointOf(declaration);
  const directory = workspaceIncusDirectory(
    options.projectDir,
    options.environment,
  );
  const credentials = await credentialsCheck(
    directory,
    options.nowMs ?? Date.now(),
  );
  const checks: DoctorCheck[] = [credentials.check];
  if (options.offline) {
    checks.push({
      id: 'incus-api',
      status: 'warn',
      detail: `Skipped the Incus API at ${endpoint} and the instance report: --offline makes no network call.`,
      fix: 'Run tale doctor without --offline to probe the Incus API.',
    });
    return checks;
  }
  if (credentials.tls === null) {
    checks.push({
      id: 'incus-api',
      status: 'warn',
      detail: `Skipped the Incus API at ${endpoint}: the CLI has no credentials to present.`,
      fix: 'Fix the credentials above, then run tale doctor again.',
    });
    return checks;
  }
  const client = (
    options.connect ??
    ((tls, url) => connectOverTls(tls, url, declaration.project))
  )(credentials.tls, endpoint);
  let probe: Awaited<ReturnType<typeof probeIncus>>;
  try {
    probe = await probeIncus(client, {
      pool: declaration.pool,
      registries: [],
    });
  } catch (error) {
    checks.push({
      id: 'incus-api',
      status: 'fail',
      detail: `The Incus API at ${endpoint} did not answer: ${message(error)}`,
      fix: `Check that Incus listens on ${endpoint} (core.https_address) and that this machine reaches it.`,
    });
    return checks;
  }
  for (const error of probe.errors)
    checks.push({ id: 'incus-api', status: 'fail', detail: error });
  for (const warning of probe.warnings)
    checks.push({ id: 'incus-api', status: 'warn', detail: warning });
  if (probe.errors.length === 0)
    checks.push({
      id: 'incus-api',
      status: 'ok',
      detail: `Incus ${probe.facts?.version ?? ''} on ${probe.facts?.architecture ?? ''} at ${endpoint}: project ${declaration.project}, pool ${declaration.pool} (${probe.facts?.poolDriver ?? ''}). tale incus check reads the whole node contract, the registries the project allows included.`,
    });
  // Without trust the project cannot be listed; the probe said why.
  if (probe.facts === null) return checks;
  try {
    checks.push(...(await instanceChecks(client, options)));
  } catch (error) {
    checks.push({
      id: 'incus-instances',
      status: 'fail',
      detail: `Could not list the instances of stack ${options.stack}: ${message(error)}`,
    });
  }
  return checks;
}
