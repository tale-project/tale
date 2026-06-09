import type { TFunction } from 'i18next';

/** Why the Auto router picked the agent that answered a message. Mirrors the
 *  backend `autoRouteReason` union persisted on message metadata. */
export type RouteReason =
  | 'single-candidate'
  | 'trivial'
  | 'cached'
  | 'classified'
  | 'fallback';

/**
 * Human-readable label for an Auto-route reason, from the `chat` namespace.
 * Explicit literal keys (not a computed `routing.reason.${reason}`) so the
 * lookup type-checks against the translation catalogue and stays exhaustive.
 */
export function routeReasonLabel(t: TFunction, reason: RouteReason): string {
  switch (reason) {
    case 'single-candidate':
      return t('routing.reason.single-candidate');
    case 'trivial':
      return t('routing.reason.trivial');
    case 'cached':
      return t('routing.reason.cached');
    case 'classified':
      return t('routing.reason.classified');
    case 'fallback':
      return t('routing.reason.fallback');
  }
  // `reason` is exhaustively handled above. The explicit return satisfies the
  // consistent-return lint and would become a type error if a new reason
  // literal were added without a matching case.
  return reason satisfies never;
}
