/**
 * Deployment-editor allowlist — pure env parsing, no Convex/Node deps.
 *
 * Writing the deployment config file (`deployment.yml` — today the
 * `sandboxRuntime` section) and the other deployment-level operator doors that
 * reuse this gate is restricted to a named set of operators. The operator lists
 * their sign-in emails in `TALE_DEPLOYMENT_CONFIG_ADMINS` at the host; viewing
 * stays open to all organization owners/admins (see `auth_policy.ts`). Data
 * residency is per organization and is not gated here.
 *
 * Kept free of Convex component imports so the logic is unit-testable in plain
 * vitest (the betterAuth/rateLimiter components don't register under convexTest).
 */

/**
 * Parse the editor email allowlist from `TALE_DEPLOYMENT_CONFIG_ADMINS`
 * (comma / semicolon / whitespace separated). Emails are trimmed + lower-cased
 * for case-insensitive matching. An empty or unset value yields an empty set —
 * i.e. nobody may edit (fail-safe).
 */
export function parseDeploymentEditors(): Set<string> {
  return new Set(
    (process.env.TALE_DEPLOYMENT_CONFIG_ADMINS ?? '')
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}

/**
 * True iff `email` is in the editor allowlist (case-insensitive). A missing
 * email or empty allowlist returns false (fail-safe).
 */
export function isDeploymentEditor(email?: string): boolean {
  if (!email) return false;
  return parseDeploymentEditors().has(email.trim().toLowerCase());
}
