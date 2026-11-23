import {
  type AllowedModelRef,
  resolveGatewayRouting,
} from '../../../lib/shared/providers/gateway_routing.ts';
import type { RelayWire } from './wires.ts';

/** A model a request may call: the connector, the model's own id, and
 * whether it rides the connector's Anthropic harness endpoint. */
export interface RelayModel {
  providerSlug: string;
  modelId: string;
  anthropicLane: boolean;
  /** The full name the harness was given (`<record>/<model>`). */
  ref: string;
}

/**
 * The allowed model a request names, or null when it names none of them.
 *
 * A harness names its model by the full name it was given, `<record>/<model>`
 * ({@link resolveGatewayRouting}); a client that drops the record names the
 * bare id. The full name settles it. A bare id settles it only where one
 * allowed model carries it — or, where both lanes of one model are allowed,
 * by the request's wire: an Anthropic-wire request rides the Anthropic lane,
 * any other the connector's own wire. A bare id two connectors share is
 * refused rather than guessed.
 */
export function matchRelayModel(
  organizationId: string,
  requested: string,
  allowed: readonly AllowedModelRef[],
  wire: RelayWire,
): RelayModel | null {
  const candidates = allowed.map((ref) => {
    const anthropicLane = ref.anthropicHarnessLane === true;
    return {
      providerSlug: ref.providerSlug,
      modelId: ref.modelId,
      anthropicLane,
      ref: resolveGatewayRouting(
        organizationId,
        ref.providerSlug,
        ref.modelId,
        {
          anthropicHarnessLane: anthropicLane,
        },
      ).gatewayModel,
    };
  });
  const exact = candidates.find((candidate) => candidate.ref === requested);
  if (exact !== undefined) return exact;

  const bare = candidates.filter(
    (candidate) => candidate.modelId === requested,
  );
  if (bare.length === 1) return bare[0] ?? null;
  if (bare.length === 0) return null;
  // One model on both lanes: the wire picks the lane.
  const slugs = new Set(bare.map((candidate) => candidate.providerSlug));
  if (slugs.size !== 1) return null;
  const wantLane = wire === 'anthropic';
  return bare.find((candidate) => candidate.anthropicLane === wantLane) ?? null;
}

/** The names a token's models answer to on `GET /openai/v1/models`. */
export function listedModels(
  organizationId: string,
  allowed: readonly AllowedModelRef[],
): string[] {
  return [
    ...new Set(
      allowed.map(
        (ref) =>
          resolveGatewayRouting(organizationId, ref.providerSlug, ref.modelId, {
            anthropicHarnessLane: ref.anthropicHarnessLane === true,
          }).gatewayModel,
      ),
    ),
  ];
}
