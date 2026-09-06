import * as logger from '../../utils/logger';
import { isLocalHostname } from '../config/ensure-env';
import { checkDaemon, checkSandboxToken } from '../docker/health-checks';

/**
 * Gate `tale deploy` on the handful of things that would otherwise fail it
 * partway through for a reason the CLI could have caught up front:
 *
 *  - the Docker daemon must be reachable,
 *  - a `letsencrypt` deployment needs a public host + a valid email (ACME
 *    cannot issue for localhost / a bare IP / a missing email),
 *
 * plus a non-blocking summary of the advisory sandbox-hardening checks so the
 * operator sees them inline, before the deploy proceeds.
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

/** The example placeholder shipped in `.env.example` — never safe for prod. */
const PLACEHOLDER_DB_PASSWORD = 'tale_password_change_me';

interface AdvisoryIssue {
  message: string;
  fix?: string;
}

/**
 * Non-blocking production-readiness advisories. These NEVER fail a deploy (a
 * real domain may legitimately differ), but surfacing them inline catches the
 * common "deployed straight from a hand-edited .env.example" footguns:
 *
 *  - a placeholder DB password still in place,
 *  - a missing audit signing key (which leaves the audit chain unsigned and
 *    the daily integrity cron unable to verify it), and
 *  - a missing audit pepper (which leaves failed sign-ins in the audit log
 *    as plaintext email + IP for the whole retention window).
 *
 * Only relevant for a real (non-local) HOST — a localhost trial doesn't need
 * any of this. Pure so it's unit-testable; the caller renders the warnings.
 */
export function checkProductionReadiness(
  env: NodeJS.ProcessEnv,
): AdvisoryIssue[] {
  const host = (env.HOST ?? '').trim();
  if (host === '' || isLocalHostname(host)) return []; // local trial — N/A

  const issues: AdvisoryIssue[] = [];
  if ((env.DB_PASSWORD ?? '').trim() === PLACEHOLDER_DB_PASSWORD) {
    issues.push({
      message: 'DB_PASSWORD is still the example placeholder.',
      fix: 'Set a strong unique DB_PASSWORD in .env (Postgres reads it only on first init).',
    });
  }
  if (!(env.TALE_AUDIT_SIGNING_KEY ?? '').trim()) {
    issues.push({
      message:
        'TALE_AUDIT_SIGNING_KEY is not set — audit checkpoints will be unsigned (tamper-evidence off).',
      fix: 'Re-run the CLI to auto-generate it, or set TALE_AUDIT_SIGNING_KEY=$(openssl rand -hex 32).',
    });
  }
  if ((env.TALE_AUDIT_PEPPER ?? '').trim().length < 16) {
    issues.push({
      message:
        'TALE_AUDIT_PEPPER is not set — failed sign-ins are written to the audit log as plaintext email + IP.',
      fix: 'Re-run the CLI to auto-generate it, or set TALE_AUDIT_PEPPER=$(openssl rand -hex 32).',
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
  //    see it inline before the deploy proceeds.
  const sandbox = checkSandboxToken(env);
  if (sandbox.status !== 'ok') {
    logger.warn(`${sandbox.name}: ${sandbox.detail}`);
    if (sandbox.fix) logger.info(`  fix: ${sandbox.fix}`);
  }

  // 4. Advisory, non-blocking: production-readiness footguns (placeholder DB
  //    password, missing audit signing key). Warn so the operator sees them
  //    inline, but never block — works the same in TTY and headless CI.
  for (const issue of checkProductionReadiness(env)) {
    logger.warn(issue.message);
    if (issue.fix) logger.info(`  fix: ${issue.fix}`);
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
