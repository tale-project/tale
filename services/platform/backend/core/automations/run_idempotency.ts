import { sortObjectKeysDeep } from '../../../lib/shared/utils/canonicalize-config.ts';
import { sha256Hex } from './webhook_token.ts';

/**
 * Run-start idempotency — what makes a retried `POST …/runs` recognisable.
 *
 * A start answers 202 before the work happens, so a lost response is the
 * ordinary case a client retries — and every retry used to start another
 * run. A caller that sends `Idempotency-Key` names the start instead: the
 * key is remembered for a day (the same window the webhook door keeps an
 * explicit delivery id), a repeat answers the run the first attempt started,
 * and a repeat that carries a DIFFERENT request under the same key is
 * refused rather than silently answered with a run of something else.
 *
 * Two digests, both bounded whatever the caller sent:
 *
 *  - the SCOPE key — the ledger row's identity: the key is one caller's
 *    choice for one automation in one scope (the URL project, or none), so
 *    the same key aimed at another automation or project is another start;
 *  - the REQUEST hash — the canonical form of what the start asked for
 *    (`input`, `mode`, `version`), compared on a repeat so a reused key with
 *    a changed body reads as the mistake it is.
 */

/** The ledger row's identity inside the organization. */
export async function runIdempotencyScopeKey(args: {
  projectId: string | undefined;
  name: string;
  key: string;
}): Promise<string> {
  return sha256Hex(`${args.projectId ?? ''}\n${args.name}\n${args.key}`);
}

/**
 * The request a key was first used for, as one digest: object keys are
 * sorted so two spellings of the same body agree, and a field the caller
 * left out (`version`) is absent from the form rather than `undefined`.
 */
export async function runIdempotencyRequestHash(args: {
  input: unknown;
  mode: 'mock' | 'live';
  version: number | undefined;
}): Promise<string> {
  return sha256Hex(
    JSON.stringify(
      sortObjectKeysDeep({
        input: args.input,
        mode: args.mode,
        version: args.version,
      }),
    ),
  );
}
