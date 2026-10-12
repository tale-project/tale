/** Operator-only organization-session fence. Never schedule it in-process:
 * initialize custody before readiness on a second rollout, after all old
 * writers/verifiers retire. Empty is the compatible unconfigured phase. */
export function parseOrgSessionCutoverAt(
  raw: string | undefined,
  now = Date.now(),
): number | null {
  if (raw === undefined || raw === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) {
    throw new Error(
      'TALE_ORG_SESSION_CUTOVER_AT must be an exact UTC ISO timestamp',
    );
  }
  const value = Date.parse(raw);
  if (!Number.isFinite(value) || new Date(value).toISOString() !== raw) {
    throw new Error(
      'TALE_ORG_SESSION_CUTOVER_AT must be an exact UTC ISO timestamp',
    );
  }
  if (value > now) {
    throw new Error(
      'TALE_ORG_SESSION_CUTOVER_AT must already have been reached before readiness',
    );
  }
  return value;
}
