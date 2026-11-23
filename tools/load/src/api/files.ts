/**
 * Files as the composer uploads them (`/api/app/files`, see
 * `backend/domains/files/routes.ts`): presign and PUT exactly as a document
 * is (`knowledge.ts`), then `register` the landed object. An audio or video
 * file registered this way is transcribed server-side: the row is stamped
 * `queued` and the pipeline job enqueued, and the batch status door reports
 * how it goes.
 */

import {
  type ApiClient,
  type ApiResult,
  asRecord,
  asString,
  mapResult,
  orgQuery,
  rowsOf,
} from './client.ts';

/** `POST /api/app/files/register?orgId=` → the file row's id. */
export async function registerFile(
  api: ApiClient,
  orgId: string,
  args: { storageRef: string; fileName: string; contentType: string },
): Promise<ApiResult<string>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: '/api/app/files/register',
    query: orgQuery(orgId),
    json: args,
    name: 'POST /api/app/files/register',
    refusals: [403, 409, 413],
  });
  return mapResult(
    result,
    (body) => asString(asRecord(body)?.fileId) ?? asString(asRecord(body)?.id),
  );
}

/** A staged file's pipelines, as the composer polls them. */
export interface FileStatus {
  storageRef: string;
  ragStatus: string | undefined;
  /** `queued`, `running`, `completed`, `failed` or `skipped`. */
  transcriptionStatus: string | undefined;
  transcriptionError: string | undefined;
  transcriptionProgress: string | undefined;
}

/** The transcription states a recording's pipeline ends in. */
export const TRANSCRIPTION_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'skipped',
]);

/** `POST /api/app/files/statuses?orgId=` — at most 20 refs at once. */
export async function fileStatuses(
  api: ApiClient,
  orgId: string,
  storageRefs: readonly string[],
): Promise<ApiResult<FileStatus[]>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: '/api/app/files/statuses',
    query: orgQuery(orgId),
    json: { storageIds: storageRefs.slice(0, 20) },
    name: 'POST /api/app/files/statuses',
  });
  return mapResult(result, (body) =>
    rowsOf(body, 'statuses').flatMap((row) => {
      const storageRef = asString(row.storageId);
      return storageRef === undefined
        ? []
        : [
            {
              storageRef,
              ragStatus: asString(row.ragStatus),
              transcriptionStatus: asString(row.transcriptionStatus),
              transcriptionError: asString(row.transcriptionError),
              transcriptionProgress: asString(row.transcriptionProgress),
            },
          ];
    }),
  );
}
