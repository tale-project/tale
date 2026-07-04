import type { CredentialRuntimeMismatchDetail } from '../agents/readiness';
import { formatEnvKeyList } from '../agents/readiness';
import { interpolateTemplate } from '../utils/interpolate';

/**
 * Resolve an app-pack hint for a credential/runtime mismatch. Apps ship copy under
 * `<messageNamespace>.readiness.mismatch.<code>` and optional
 * `<messageNamespace>.readiness.openAgent` — the platform never hardcodes product
 * runtime names in user-facing strings. Templates may use `{agent}`, `{expectedKeys}`,
 * `{configuredKeys}`, `{expectedKey}`, `{configuredKey}`.
 */
export function resolvePackReadinessHint(
  messageNamespace: string | undefined,
  labels: Record<string, string>,
  mismatch: CredentialRuntimeMismatchDetail | undefined,
  agentDisplayName: string,
): string | undefined {
  if (!mismatch || !messageNamespace) return undefined;
  const template =
    labels[`${messageNamespace}.readiness.mismatch.${mismatch.code}`];
  if (!template) return undefined;
  return interpolateTemplate(template, {
    agent: agentDisplayName,
    expectedKeys: formatEnvKeyList(mismatch.expectedKeys),
    configuredKeys: formatEnvKeyList(mismatch.configuredKeys),
    expectedKey: mismatch.expectedKeys[0] ?? '',
    configuredKey: mismatch.configuredKeys[0] ?? '',
  });
}

export function resolvePackReadinessOpenAgentLabel(
  messageNamespace: string | undefined,
  labels: Record<string, string>,
): string | undefined {
  if (!messageNamespace) return undefined;
  return labels[`${messageNamespace}.readiness.openAgent`];
}
