/** External ports for the exact retained host. No run status, epoch or
 * migration is interpreted here. Unused external services refuse loudly. */
import { AsyncLocalStorage } from 'node:async_hooks';

import type * as Harness from '../../../backend/core/chat/external_turn_shared.ts';
import type { ActionCtx } from '../../../backend/core/lib/ctx.ts';
import type * as Session from '../../../backend/core/node_only/sandbox/helpers/session_client.ts';
import type * as Gateway from '../../../backend/core/node_only/sandbox/llm_gateway_admin.ts';
import type * as Routing from '../../../lib/shared/providers/gateway_routing.ts';

export interface LegacyAgentPorts {
  events: string[];
  tokens?: Array<{ expiresAt: number; keyId: string | null }>;
  revokedKeys?: string[];
  after?: (event: string) => Promise<void>;
}
const ports = new AsyncLocalStorage<LegacyAgentPorts>();
export function withLegacyAgentPorts<T>(
  value: LegacyAgentPorts,
  action: () => Promise<T>,
): Promise<T> {
  return ports.run(value, action);
}
export async function legacyAgentEvent(event: string): Promise<void> {
  const current = ports.getStore();
  if (current === undefined) throw new Error('legacy agent ports are absent');
  current.events.push(event);
  await current.after?.(event);
}
export function legacyAgentToken(
  expiresAt: number,
  keyId: string | null,
): void {
  const current = ports.getStore();
  if (current === undefined) throw new Error('legacy agent ports are absent');
  current.tokens?.push({ expiresAt, keyId });
}
function refuse(): never {
  throw new Error('legacy agent fixture reached an unsupported external port');
}
export function traceSandboxPhase<T>(_phase: string, run: () => T): T {
  return run();
}
export const buildExternalTurnExec: typeof Harness.buildExternalTurnExec =
  () => ({ argv: ['fixture-no-process'], env: {}, cwd: '/agent' });
export const drainHarnessWindow: typeof Harness.drainHarnessWindow =
  async () => {
    await legacyAgentEvent('harness');
    return { kind: 'running', text: '', timeline: [] };
  };
export const connectorsBridgeUrlForSessions = () => 'http://fixture.invalid';
export const harnessMountsMcp: typeof Harness.harnessMountsMcp = () => false;
export const harnessResumesConversations: typeof Harness.harnessResumesConversations =
  () => true;
export const harnessRequiresSubscriptionAccountId: typeof Harness.harnessRequiresSubscriptionAccountId =
  () => false;
/** The released window resolver's arguments. */
interface ReleasedContextWindowArgs {
  organizationId: string;
  providerSlug: string;
  modelId: string;
  sessionId: string;
  execId: string;
  kind: 'task-agent' | 'workflow-agent';
}
/** The released window resolver: the model's window in tokens, or nothing.
 * The live one answers the window and the output limit together
 * (`resolveHarnessTurnModelLimits`); the released flow still calls this port
 * by its name. */
export const resolveHarnessTurnContextWindow = async (
  _ctx: ActionCtx,
  _args: ReleasedContextWindowArgs,
): Promise<number | undefined> => undefined;
export const readMandatoryInstructions: typeof import('../../../backend/core/chat/guardrails.ts').readMandatoryInstructions =
  async () => undefined;
export const orgSlugFromId: typeof import('../../../backend/core/lib/helpers/org_slug.ts').orgSlugFromId =
  refuse;
export const resolveWorkflowAgentServing: typeof import('../../../backend/core/lib/providers/agent_serving.ts').resolveWorkflowAgentServing =
  async () => ({ lane: 'gateway', providerSlug: 'fixture', modelId: 'model' });
export const resolveTurnImageGeneration: typeof import('../../../backend/core/lib/providers/resolve_image_model.ts').resolveTurnImageGeneration =
  async () => null;
export const resolveTurnVisionModel: typeof import('../../../backend/core/lib/providers/resolve_vision_model.ts').resolveTurnVisionModel =
  async () => null;
export const ensureAgentSession: typeof import('../../../backend/core/node_only/sandbox/agent_session.ts').ensureAgentSession =
  async () => {
    await legacyAgentEvent('session');
    return { liveCreatedAt: undefined };
  };
/** The released provisioner's arguments, before the EU/EEA rule (GOV-R17)
 * named the surface and actor its refusals audit. The sandbox LLM gateway's
 * provisioner itself is gone (tale-project/tale#4942); the released flow
 * still calls this port by its name. */
interface ReleasedGatewayKeyArgs {
  organizationId: string;
  sessionId: string;
  allowedModels: Routing.AllowedModelRef[];
  budgetCents: number;
}
/** Takes the released call. */
export const provisionSessionGatewayKey = async (
  _ctx: ActionCtx,
  _args: ReleasedGatewayKeyArgs,
): Promise<{ token: string; keyId: string; keyHash: string }> => {
  await legacyAgentEvent('gateway');
  return {
    token: 'synthetic-only',
    keyId: 'fixture-key',
    keyHash: 'fixture-hash',
  };
};
export const sessionDeleteFiles: typeof Session.sessionDeleteFiles = refuse;
export const sessionStageFiles: typeof Session.sessionStageFiles = refuse;
export const stageUrlForBlobRef: typeof import('../../../backend/core/node_only/sandbox/helpers/stage_url.ts').stageUrlForBlobRef =
  refuse;
export const readVirtualKeySpend: typeof Gateway.readVirtualKeySpend =
  async () => ({ status: 'ok', cents: 0 });
export const revokeVirtualKey: typeof Gateway.revokeVirtualKey = async (
  keyId,
) => {
  ports.getStore()?.revokedKeys?.push(keyId);
  await legacyAgentEvent('key-revoked');
};
export const resolveGatewayRouting: typeof Routing.resolveGatewayRouting =
  () => ({
    gatewayProvider: 'fixture',
    gatewayModel: 'fixture/model',
  });
export const harvestSessionOutput: typeof import('../../../backend/core/node_only/sandbox/session_exec.ts').harvestSessionOutput =
  refuse;
export const resolveTurnEquipmentEnv: typeof import('../../../backend/core/node_only/sandbox/turn_equipment.ts').resolveTurnEquipmentEnv =
  async () => {
    await legacyAgentEvent('equipment');
    return {};
  };
export const resolveProviderCredential: typeof import('../../../backend/core/provider_credentials/resolve_credential.ts').resolveProviderCredential =
  refuse;
