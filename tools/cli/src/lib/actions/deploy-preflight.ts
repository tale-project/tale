import { checkDaemon, checkSandboxToken } from '../../commands/doctor';
import * as logger from '../../utils/logger';
import { isLocalHostname } from '../config/ensure-env';

/**
 * Gate `tale deploy` on the handful of things that would otherwise fail it
 * partway through for a reason the CLI could have caught up front:
 *
 *  - the Docker daemon must be reachable,
 *  - a `letsencrypt` deployment needs a public host + a valid email (ACME
 *    cannot issue for localhost / a bare IP / a missing email),
 *
 * plus a non-blocking summary of the advisory sandbox-hardening checks so the
 * operator sees them without having to run `tale doctor` separately.
 */

interface TlsConfig {
  tlsMode: string | undefined;
  host: string | undefined;
  tlsEmail: string | undefined;
}

interface PreflightIssue {
  message: string;
}

/**
 * Pure TLS-prerequisite validation. Returns the blocking issues (empty when
 * fine). `selfsigned` is always valid; `letsencrypt` requires a public host
 * and a plausible email.
 */
export function validateTlsPrereqs(config: TlsConfig): PreflightIssue[] {
  if (config.tlsMode !== 'letsencrypt') return [];

  const issues: PreflightIssue[] = [];
  const host = (config.host ?? '').trim();
  if (!host || isLocalHostname(host)) {
    issues.push({
      message:
        `TLS_MODE=letsencrypt needs a public domain, but HOST is "${host || '(unset)'}". ` +
        "Let's Encrypt cannot issue certificates for localhost or a bare IP. " +
        'Set HOST to a public domain, or use TLS_MODE=selfsigned.',
    });
  }
  const email = (config.tlsEmail ?? '').trim();
  if (!email || !email.includes('@')) {
    issues.push({
      message:
        'TLS_MODE=letsencrypt requires TLS_EMAIL for certificate notifications. Set a valid email in .env.',
    });
  }
  return issues;
}

interface DeployPreflightOptions {
  /** Read TLS settings from here (defaults to process.env after loadEnv). */
  env?: NodeJS.ProcessEnv;
  /** Dry-run reports problems but never blocks. */
  dryRun?: boolean;
}

interface DeployPreflightResult {
  ok: boolean;
  blocking: PreflightIssue[];
}

/**
 * Run the deploy preflight. Throws on a blocking failure (so the deploy
 * command exits non-zero before mutating anything); on `dryRun` it reports
 * problems as warnings and never throws.
 */
export async function runDeployPreflight(
  options: DeployPreflightOptions = {},
): Promise<DeployPreflightResult> {
  const env = options.env ?? process.env;
  const blocking: PreflightIssue[] = [];

  logger.step('Running deploy preflight…');

  // 1. Docker daemon must answer.
  const daemon = await checkDaemon();
  if (daemon.status === 'fail') {
    blocking.push({
      message:
        `Docker daemon not reachable: ${daemon.detail}. ${daemon.fix ?? ''}`.trim(),
    });
  }

  // 2. TLS prerequisites for a real certificate.
  const tlsIssues = validateTlsPrereqs({
    tlsMode: env.TLS_MODE,
    host: env.HOST,
    tlsEmail: env.TLS_EMAIL,
  });
  blocking.push(...tlsIssues);

  // 3. Advisory, non-blocking: surface the sandbox secret check so operators
  //    see it inline rather than having to run `tale doctor`.
  const sandbox = checkSandboxToken(env);
  if (sandbox.status !== 'ok') {
    logger.warn(`${sandbox.name}: ${sandbox.detail}`);
    if (sandbox.fix) logger.info(`  fix: ${sandbox.fix}`);
  }

  if (blocking.length === 0) {
    logger.success('Preflight passed.');
    return { ok: true, blocking };
  }

  for (const issue of blocking) logger.error(issue.message);

  if (options.dryRun) {
    logger.warn(
      'Dry-run: the above would block a real deploy. Fix them before deploying.',
    );
    return { ok: false, blocking };
  }

  throw new Error(
    `Deploy preflight failed (${blocking.length} issue${blocking.length === 1 ? '' : 's'}). See above.`,
  );
}
