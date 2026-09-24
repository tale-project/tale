/**
 * Which conversation-routing rule a new conversation matches — pure, so the
 * precedence is testable without a database. The rules and their order are
 * documented on `conversationRoutingConfigSchema`.
 */

import type {
  ConversationRoutingConfig,
  ConversationRoutingRule,
  ConversationRoutingSourceRule,
} from '@tale/shared/schemas/governance';

import { baseAddress, normalizedAddress } from './subaddress';

/** Where a conversation arrived. */
export type RoutingArrival =
  | {
      lane: 'email';
      /** The mailbox (connector credential) it came through, when known. */
      credentialId?: string;
      /** The address it was sent to (`metadata.to[0].address`). */
      recipient?: string;
    }
  | { lane: 'api'; source: string };

export interface RoutingTarget {
  teamId?: string;
  userId?: string;
}

type AnyRule = ConversationRoutingRule | ConversationRoutingSourceRule;

function hasTarget(rule: AnyRule): boolean {
  return Boolean(rule.teamId || rule.userId);
}

function targetOf(rule: AnyRule): RoutingTarget {
  return {
    ...(rule.teamId ? { teamId: rule.teamId } : {}),
    ...(rule.userId ? { userId: rule.userId } : {}),
  };
}

/** The rule's address equals the recipient. */
function exactMatch(ruleAddress: string, recipient: string): boolean {
  return normalizedAddress(ruleAddress) === normalizedAddress(recipient);
}

/** A tag-free rule address equals the recipient with its tag removed. */
function baseMatch(ruleAddress: string, recipient: string): boolean {
  if (ruleAddress.includes('+')) return false;
  const base = baseAddress(recipient);
  return base !== undefined && normalizedAddress(ruleAddress) === base;
}

/**
 * The team and/or person a new conversation routes to, or `undefined`. Only
 * a rule that names a target is a candidate, so a rule left without one never
 * shadows the rules after it.
 */
export function matchRoutingRule(
  config: ConversationRoutingConfig,
  arrival: RoutingArrival,
): RoutingTarget | undefined {
  if (config.enabled === false) return undefined;
  const sourceRules = config.sourceRules.filter(hasTarget);

  if (arrival.lane === 'api') {
    const rule = sourceRules.find(
      (candidate) => candidate.apiSource === arrival.source,
    );
    return rule ? targetOf(rule) : undefined;
  }

  const { credentialId, recipient } = arrival;
  const onMailbox =
    credentialId === undefined
      ? []
      : sourceRules.filter((candidate) => candidate.mailbox === credentialId);
  const anyMailbox = config.rules.filter(hasTarget);
  const tiers: Array<() => AnyRule | undefined> = [
    () =>
      recipient === undefined
        ? undefined
        : onMailbox.find(
            (rule) =>
              rule.address !== undefined && exactMatch(rule.address, recipient),
          ),
    () =>
      recipient === undefined
        ? undefined
        : onMailbox.find(
            (rule) =>
              rule.address !== undefined && baseMatch(rule.address, recipient),
          ),
    () =>
      recipient === undefined
        ? undefined
        : anyMailbox.find((rule) => exactMatch(rule.address, recipient)),
    () =>
      recipient === undefined
        ? undefined
        : anyMailbox.find((rule) => baseMatch(rule.address, recipient)),
    () => onMailbox.find((rule) => rule.address === undefined),
  ];
  for (const tier of tiers) {
    const rule = tier();
    if (rule !== undefined) return targetOf(rule);
  }
  return undefined;
}
