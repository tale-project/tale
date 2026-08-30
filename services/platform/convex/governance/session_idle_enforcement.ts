import { sessionIdleTimeoutConfigSchema } from '../../lib/shared/schemas/governance';
import { resolveEffectiveIdleMinutes } from '../../lib/shared/session-idle';
interface OrgIdleWindow {
  organizationId: string;
  minutes: number;
}

/**
 * Resolve the orgs that have an ENABLED `session_idle_timeout` policy into
 * their effective idle window (already tightened against the env backstop).
 * Invalid configs are logged and skipped (parse-or-skip, like
 * `getTwoFactorPolicy`); disabled/absent policies defer to the env backstop,
 * which Better Auth's own sliding `expiresIn` already enforces server-side —
 * nothing for the sweep to do there.
 *
 * Pure (env value passed in, not read here) so it is unit-testable.
 */
export function resolveOrgIdleWindows(
  policies: ReadonlyArray<{ organizationId: string; config: unknown }>,
  envMinutes: number | null,
): OrgIdleWindow[] {
  const windows: OrgIdleWindow[] = [];
  for (const row of policies) {
    const parsed = sessionIdleTimeoutConfigSchema.safeParse(row.config);
    if (!parsed.success) {
      console.warn(
        `[session-idle] invalid session_idle_timeout config for org ${row.organizationId}; skipping sweep for this org`,
        parsed.error,
      );
      continue;
    }
    if (!parsed.data.enabled) continue;
    const minutes = resolveEffectiveIdleMinutes({
      policy: parsed.data,
      envMinutes,
    });
    if (minutes === null) continue;
    windows.push({ organizationId: row.organizationId, minutes });
  }
  return windows;
}

/**
 * Revocation decision for a single session row. Already-expired sessions are
 * dead — Better Auth rejects them on next use — so revoking them would only
 * burn the per-run write budget.
 */
export function shouldRevokeIdleSession(args: {
  updatedAt: number;
  expiresAt: number;
  windowMs: number;
  now: number;
}): boolean {
  if (args.expiresAt <= args.now) return false;
  return args.now - args.updatedAt > args.windowMs;
}
