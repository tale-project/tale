/**
 * The heavy slot's child: a process started for one request, which does it,
 * answers, and exits.
 *
 * Run by `slot.ts` with a heap limit and under its watch. It says it is
 * ready, takes the one request, and sends the one answer; a request that
 * fails is an answer too (`operations.ts`). It is given no secret and opens
 * no connection: it reads the files its request names and writes the files
 * its request names.
 *
 * Built as its own entry (`heavy-child.js`), so what a child loads is what
 * its work imports and nothing of the backend around it.
 */

import { runHeavyRequest } from './operations.ts';
import type { HeavyRequest } from './protocol.ts';

function isRequest(value: unknown): value is HeavyRequest {
  return (
    value !== null &&
    typeof value === 'object' &&
    'op' in value &&
    typeof value.op === 'string' &&
    'inputPath' in value &&
    typeof value.inputPath === 'string'
  );
}

// A child whose parent is gone has nobody to answer.
process.on('disconnect', () => process.exit(1));

process.once('message', (request: unknown) => {
  const work = isRequest(request)
    ? runHeavyRequest(request)
    : Promise.resolve({
        ok: false as const,
        error: {
          kind: 'other' as const,
          message: 'the heavy slot was sent something that is no request',
        },
      });
  void work.then((answer) => {
    // Exit once the answer has left: the parent waits for nothing else.
    process.send?.(answer, () => process.exit(0));
  });
});

process.send?.({ ready: true });
