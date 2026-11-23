/**
 * Which keys the in-process model relay serves (tale-project/tale#4942).
 *
 * A turn's key is minted either for the relay (`tr_<uuid>`, `issueRelayKey`)
 * or, before the relay, for the sandbox LLM gateway (a gateway virtual key's
 * own id). The two are settled differently: a relay key's spend is on its
 * turn's op row, and revoking it is revoking its tokens; a gateway key's
 * spend is read from the gateway, which deletes the key. Every settlement
 * asks which one it holds here.
 */

/** The id prefix of a key the model relay serves. */
export const RELAY_KEY_PREFIX = 'tr_';

/** Whether the model relay serves this key; any other is a gateway key. */
export function isRelayKeyId(keyId: string): boolean {
  return keyId.startsWith(RELAY_KEY_PREFIX);
}
