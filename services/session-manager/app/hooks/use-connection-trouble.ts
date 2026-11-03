import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError } from '@/app/lib/api/client';

/**
 * How long a failed poll is given before the person is told of it: the poll is
 * tried once more, and only a second failure counts. Mirrors the platform's
 * `DISCONNECT_GRACE_MS` (`components/connectivity/online-gate.tsx`), which keeps
 * its overlay from flashing "on benign blips" (a server restarting, a laptop
 * waking up, one request lost).
 */
export const CONNECTION_GRACE_MS = 3_000;

/** What stands between the page and the server: no answer, or an answer that is an error. */
type ConnectionTrouble = 'unreachable' | 'failed';

type Probe = Pick<
  UseQueryResult,
  'error' | 'errorUpdatedAt' | 'dataUpdatedAt' | 'refetch'
>;

function troubleOf(error: unknown): ConnectionTrouble {
  return error instanceof ApiError && error.code === 'network'
    ? 'unreachable'
    : 'failed';
}

/**
 * Whether the read that probes the server fails for good, and how. The server
 * that sends nothing back is out of reach; one that answers with an error
 * (`ApiError` names its status; a body the page cannot read is one too) is
 * reached and says it is in trouble: the two are told apart, so that the words
 * match what is going on (the platform's `online-gate.tsx` does the same for a
 * device that is offline and a server that is unreachable).
 *
 * "For good" is a failure that stands for the grace and is not answered when
 * the probe asks again.
 */
export function useConnectionTrouble({
  error,
  errorUpdatedAt,
  dataUpdatedAt,
  refetch,
}: Probe): ConnectionTrouble | null {
  // What the probe heard last was a failure, not an answer. (Not `isError`: a
  // read that never had an answer goes back to pending while it tries again.)
  const failing = errorUpdatedAt > dataUpdatedAt;
  // A run of failures is named by the answer before it. The one that was asked
  // about, and failed again, stands for that run alone: the next answer ends it.
  const [confirmed, setConfirmed] = useState<{
    run: number;
    trouble: ConnectionTrouble;
  } | null>(null);

  useEffect(() => {
    if (!failing) return undefined;
    let current = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        const result = await refetch();
        if (current && result.isError) {
          setConfirmed({
            run: dataUpdatedAt,
            trouble: troubleOf(result.error),
          });
        }
      })();
    }, CONNECTION_GRACE_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [failing, dataUpdatedAt, refetch]);

  if (!failing || confirmed === null || confirmed.run !== dataUpdatedAt) {
    return null;
  }
  // The error the probe holds now, which can have changed since (the server
  // came back, answering with an error); while it tries again it holds none,
  // and the one it was confirmed with stands.
  return error === null ? confirmed.trouble : troubleOf(error);
}
