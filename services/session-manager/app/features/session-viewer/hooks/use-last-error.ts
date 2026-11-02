import { useState } from 'react';

/**
 * The failure a read last had, kept while the read is made again. A query that
 * has never worked loses its error the moment it is asked once more and reads
 * as loading, which would turn the page that says the read failed into one
 * that says it is loading, and take the retry button from the person who just
 * pressed it.
 */
export function useLastError<T>(error: T | null): T | null {
  const [last, setLast] = useState<T | null>(error);
  if (error !== null && error !== last) setLast(error);
  return error ?? last;
}
