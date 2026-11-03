import { addressOf, type E2eServerAddress } from '../servers.ts';
import { PLAN } from './env';

/**
 * The servers of the other workers: for a spec to look at (that nothing of its
 * own reached them), never to change. A worker's own server is the `server`
 * fixture.
 */
export function peersOf(server: E2eServerAddress): E2eServerAddress[] {
  return Array.from({ length: PLAN.servers }, (_one, index) =>
    addressOf(PLAN, index),
  ).filter((peer) => peer.index !== server.index);
}
