import { firstFailureDetail } from '@/app/lib/backend/adapters';
import { AppError } from '@/lib/shared/errors/app-error';

/** A cloud import's answer, as both import doors send it. */
export interface CloudImportAnswer {
  success: boolean;
  results: ReadonlyArray<{
    fileName: string;
    status: 'success' | 'skipped' | 'error';
    /** Why the file was refused, in words a person can read — only for a
     *  refusal Tale wrote for people; a fault carries none. */
    reason?: { code: string; message: string };
  }>;
  totalFiles: number;
  successCount: number;
  skippedCount: number;
  /** The backend's own English — the grant check's sentence when access
   *  ended — for the log, and for the lapsed-grant rule alone. */
  error?: string;
}

/** An import that access ended part-way: what the connect dialog says. */
export interface CloudImportInterruption {
  /** Files of the selection imported before access ended — by this import,
   *  or unchanged by an earlier one. */
  imported: number;
  /** Files the import set out to bring in; unknown when access ended while
   *  the selected folders were still being listed. */
  total?: number;
}

/** The first failed file, and its reason when it has words to show. */
export interface CloudImportFailure {
  name: string;
  reason: string;
}

export type CloudImportOutcome =
  | { kind: 'completed'; imported: number; total: number }
  | { kind: 'interrupted'; interruption: CloudImportInterruption }
  | {
      kind: 'partial';
      imported: number;
      total: number;
      failure: CloudImportFailure | undefined;
    }
  | { kind: 'failed'; total: number; failure: CloudImportFailure | undefined };

/**
 * How an import's answer reads for the person.
 *
 * A file counts as imported when this import brought it in, or skipped it
 * because an earlier import had already brought it in unchanged — so the
 * same selection imported again after reconnecting counts the files the
 * first run brought in as well as the rest.
 *
 * An answer that carries the grant check's sentence (`isLapsedGrant`, the
 * rule each listing hands off on) ended because access did: the connect
 * dialog reports it. Otherwise a failure is partial when some files came in
 * and failed when none did; either way it names the first failed file with
 * that failure's words (`firstFailureDetail`), or nothing when it was a
 * fault — a provider's answer or the backend's English never shows.
 */
export function readCloudImportAnswer(
  answer: CloudImportAnswer,
  isLapsedGrant: (error: unknown) => boolean,
): CloudImportOutcome {
  const imported = answer.successCount + answer.skippedCount;
  const total = answer.totalFiles;
  if (answer.success) return { kind: 'completed', imported, total };
  if (answer.error !== undefined && isLapsedGrant(answer.error)) {
    return { kind: 'interrupted', interruption: { imported, total } };
  }
  const failed = answer.results.filter((row) => row.status === 'error');
  const reason = firstFailureDetail(
    failed.map((row) =>
      row.reason === undefined ? undefined : new AppError(row.reason),
    ),
  );
  const first = failed[0];
  const failure =
    first !== undefined && reason !== undefined
      ? { name: first.fileName, reason }
      : undefined;
  return imported > 0
    ? { kind: 'partial', imported, total, failure }
    : { kind: 'failed', total, failure };
}
