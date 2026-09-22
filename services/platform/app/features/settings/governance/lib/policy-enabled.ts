/**
 * Whether a governance policy is switched on.
 *
 * The app door answers `GET /governance/policies/:type` with
 * `{policy: {key, config}}` — the on/off flag lives INSIDE `config`
 * (`config.enabled`), which is also where every editor writes it. There is no
 * policy-level `enabled`; the panels that read one were left over from the
 * previous row shape and showed "Off" for a policy the server had enabled.
 * One reader, so the switch, the editor and the overview cards agree.
 */
export function policyEnabled(
  policy: { config: unknown } | null | undefined,
): boolean {
  const config = policy?.config;
  if (typeof config !== 'object' || config === null) return false;
  return (config as { enabled?: unknown }).enabled === true;
}
