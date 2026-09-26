'use node';

/**
 * Account accounting stays stable across token refresh when the broker
 * supplies an id. Legacy pools and in-flight runs still use token hashes.
 * Neither identity nor plaintext credential is persisted in selection state.
 */

import { createHash } from 'node:crypto';

import type { BrokerPoolAccount } from './broker_pool';

/** sha256 hex (64 chars) of a broker pool token. Accounting only — the
 * plaintext token never persists anywhere. */
export function hashBrokerToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The broker's account id is local to the selected credential. A length-safe
 * tuple prevents delimiter collisions; vendor ids and token bytes can change
 * independently without resetting rotation or failure exclusions.
 */
export function hashBrokerAccount(
  credentialId: string,
  account: BrokerPoolAccount,
): string {
  if (account.id === undefined) return hashBrokerToken(account.token);
  return createHash('sha256')
    .update(JSON.stringify(['broker-account-v1', credentialId, account.id]))
    .digest('hex');
}
