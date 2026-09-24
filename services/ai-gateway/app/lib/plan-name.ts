/**
 * How a vendor's plan reads in the panel.
 *
 * Plan names are the vendors' own product names — "Max", "Plus", "Pro Lite" —
 * so they live beside the other brands in `messages/global.yml` and read the
 * same in every language. A plan the catalog has no name for is shown as the
 * vendor's id made readable ("edu_plus" → "Edu plus") rather than dropped:
 * the vendor said something true, and a blank would say nothing.
 */

import type { TFunction } from 'i18next';

import type { ProviderId, Subscription } from '@/app/lib/api';

/** A vendor id with its separators opened up and its first letter raised. */
function readableId(id: string): string {
  const spaced = id.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The name of an account's plan, with the multiple it is sold at when it has
 * one ("Max 20x"). `t` is the `accounts` namespace, where the names live.
 */
export function planName(
  provider: ProviderId,
  subscription: Subscription,
  t: TFunction,
): string {
  const name = t(`plans.${provider}.${subscription.plan}`, {
    defaultValue: readableId(subscription.plan),
  });
  return subscription.tier
    ? t('plans.withTier', { plan: name, tier: subscription.tier })
    : name;
}
