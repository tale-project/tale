import { computeContentHash } from './hashing';
import { stableStringify } from './stable-stringify';

/**
 * The identity of a native configuration value: the SHA-256 (hex) of its
 * key-sorted JSON ({@link stableStringify}). The platform answers it as a
 * resource's `hash` and takes it back as `expectedHash`, the compare-and-set
 * precondition of every configuration write; the CLI's plans and the MCP
 * settings tools compare against the same digest.
 *
 * Server-only (Node's crypto). A digest, once recorded, must never move:
 * `configuration-hash.test.ts` pins a golden corpus.
 */
export function configurationHash(value: unknown): string {
  return computeContentHash(stableStringify(value));
}
