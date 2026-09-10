import type { SandboxDeploymentLimits } from '../../../lib/shared/schemas/sandbox-capacity.ts';
import { sandboxDeploymentLimits } from '../../core/node_only/sandbox/helpers/session_client.ts';

/** Never invent an editable ceiling when the configured spawner cannot answer. */
export async function getSandboxDeploymentLimits(
  organizationId: string,
): Promise<SandboxDeploymentLimits> {
  if (!process.env.SANDBOX_TOKEN?.trim()) {
    return { status: 'unavailable', reason: 'not_configured' };
  }
  try {
    return {
      status: 'available',
      ...(await sandboxDeploymentLimits(organizationId)),
    };
  } catch (error) {
    console.warn(
      '[sandbox] deployment limits unavailable:',
      error instanceof Error ? error.message : 'unknown failure',
    );
    return { status: 'unavailable', reason: 'unreachable' };
  }
}
