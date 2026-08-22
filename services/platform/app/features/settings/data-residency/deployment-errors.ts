/**
 * Map a thrown error from a deployment-config action into an operator-facing
 * message + the structured code. Duck-types `ConvexError.data` because Vite
 * chunk splitting can produce multiple `ConvexError` class copies that break
 * `instanceof` (same rationale as the org-residency mapper it sits beside).
 */

type Translator = (key: string, options?: Record<string, unknown>) => string;

export interface DeploymentErrorMapping {
  /** Structured error code when present (e.g. DEPLOYMENT_VERSION_CONFLICT). */
  code?: string;
  /** Operator-facing message, already localized. */
  message: string;
  /**
   * True when the failure is an undecryptable secrets sidecar that a
   * force-overwrite can recover (DEPLOYMENT_SECRET_REFUSED_OVERWRITE).
   */
  canForceOverwrite: boolean;
}

function readConvexErrorData(
  err: unknown,
): Record<string, unknown> | undefined {
  if (err == null || typeof err !== 'object') return undefined;
  if (!('data' in err)) return undefined;
  const data = err.data;
  if (data == null || typeof data !== 'object') return undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtime-checked above
  return data as Record<string, unknown>;
}

function pickString(data: unknown, key: string): string | undefined {
  if (data == null || typeof data !== 'object') return undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtime-checked above
  const v = (data as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : undefined;
}

/** Format the `issues` array of an INVALID_DEPLOYMENT_CONFIG error, if present. */
function formatIssues(
  data: Record<string, unknown> | undefined,
): string | undefined {
  const issues = data?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return undefined;
  return issues
    .map((i) => {
      const path = pickString(i, 'path');
      const message = pickString(i, 'message');
      return path ? `${path}: ${message ?? ''}`.trim() : (message ?? '');
    })
    .filter(Boolean)
    .join('; ');
}

export function mapDeploymentError(
  err: unknown,
  t: Translator,
): DeploymentErrorMapping {
  const data = readConvexErrorData(err);
  const code = pickString(data, 'code');
  const serverMessage = pickString(data, 'message');
  const fallback =
    serverMessage ?? (err instanceof Error ? err.message : String(err));

  switch (code) {
    case 'DEPLOYMENT_VERSION_CONFLICT':
      return {
        code,
        message: t('dataResidency.errors.versionConflict'),
        canForceOverwrite: false,
      };
    case 'INVALID_DEPLOYMENT_CONFIG': {
      const issues = formatIssues(data);
      return {
        code,
        message: issues
          ? t('dataResidency.errors.invalidConfig', { issues })
          : t('dataResidency.errors.invalidConfigGeneric'),
        canForceOverwrite: false,
      };
    }
    case 'UNAUTHENTICATED':
    case 'FORBIDDEN_INSTANCE_ADMIN':
    case 'FORBIDDEN_DEPLOYMENT_EDITOR':
      return {
        code,
        message: serverMessage ?? t('dataResidency.errors.forbidden'),
        canForceOverwrite: false,
      };
    case 'DEPLOYMENT_SECRET_REFUSED_OVERWRITE':
      return {
        code,
        message: t('dataResidency.errors.secretUnreadable'),
        canForceOverwrite: true,
      };
    case 'DEPLOYMENT_CONFIG_UNREADABLE':
      return {
        code,
        message: serverMessage ?? t('dataResidency.errors.configUnreadable'),
        canForceOverwrite: false,
      };
    default:
      return { code, message: fallback, canForceOverwrite: false };
  }
}
