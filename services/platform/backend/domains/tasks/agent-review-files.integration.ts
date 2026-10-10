/** Real native token -> PG authority -> signed blob stream -> runnerd write.
 * Only the spawner transport is inert. No provider/model or agent is started.
 * /agent is mapped into a unique retained fixture workspace for the daemon. */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { TaskAgentReviewInput } from '@tale/shared/schemas/task-review';
import type { Sql } from 'postgres';
import { z } from 'zod/v4';

import { stageFiles } from '../../../../sandbox-runtime/daemon/src/file-ops.ts';
import {
  itestObjectStore,
  recordSkip,
} from '../../integration-lane-helpers.ts';
import {
  buildObjectKey,
  resolveObjectStore,
  s3HeadObject,
  s3PutObject,
} from '../../lib/object-store.ts';
import { deleteFile } from '../files/service.ts';
import { ensureDefaultObjectStore } from '../object_storage/bootstrap.ts';
import type { ProjectAuthContext } from '../projects/service.ts';
import {
  agentRecordTaskOutputsTrusted,
  updateTask,
  type TaskAttachmentEntry,
} from './service.ts';

type Body = Record<string, unknown>;
const isRecord = (value: unknown): value is Body =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const output = (body: Body): Body => (isRecord(body.output) ? body.output : {});
const checksum = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const stageBody = z
  .object({
    files: z
      .array(z.object({ path: z.string(), url: z.string() }).strict())
      .length(1),
  })
  .strict();

export async function checkAgentReviewFiles(args: {
  sql: Sql;
  auth: ProjectAuthContext;
  base: string;
  orgId: string;
  foreignOrgId: string;
  orgSlug: string;
  reviewerId: string;
  sessionId: string;
  token: string;
  record: (name: string, ok: boolean, detail: string) => void;
  submit: (title: string) => Promise<{ taskId: string; runId: string }>;
  inputFor: (taskId: string) => Promise<TaskAgentReviewInput>;
  dispatch: (token: string, input: unknown, tool?: string) => Promise<Body>;
  snapshot: (taskId: string) => Promise<unknown>;
  transferToHuman: (taskId: string) => Promise<unknown>;
}) {
  const { sql, record, orgId, token, dispatch } = args;
  const fixtureStore = itestObjectStore();
  if (fixtureStore === null) {
    recordSkip(
      record,
      'agent review files native byte transfer',
      'no ITEST_S3_ENDPOINT — review file bytes were not exercised',
    );
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), 'tale-review-files-'));
  const spawnerToken = randomUUID();
  const prior = new Map(
    [
      'SANDBOX_URL',
      'SANDBOX_TOKEN',
      'SANDBOX_HTTP_API_BASE_URL',
      'TALE_WORKSPACE_ROOT',
    ].map((name) => [name, process.env[name]]),
  );
  let stageCalls = 0;
  let afterStage: (() => Promise<unknown>) | undefined;
  const stageFailures: string[] = [];
  const spawner = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      const run = async () => {
        const target = `/v1/sessions/${encodeURIComponent(args.sessionId)}/files/stage`;
        const signed = `${request.method}\n${request.url}\n${String(request.headers['x-tale-sandbox-timestamp'])}\n${String(request.headers['x-tale-sandbox-nonce'])}\n${checksum(Buffer.from(body))}`;
        if (
          request.method !== 'POST' ||
          request.url !== target ||
          request.headers['x-tale-sandbox-signature'] !==
            createHmac('sha256', spawnerToken).update(signed).digest('hex')
        ) {
          response.writeHead(403).end();
          return;
        }
        const parsed = stageBody.safeParse(JSON.parse(body));
        if (
          !parsed.success ||
          parsed.data.files.some(
            (file) => !file.path.startsWith('/agent/inputs/reviews/'),
          )
        ) {
          response.writeHead(400).end();
          return;
        }
        stageCalls += 1;
        const files = parsed.data.files.map((file) => ({
          url: file.url,
          path: path.join(root, file.path.slice('/agent/'.length)),
        }));
        const result = await stageFiles(files);
        const remap = (filePath: string) =>
          `/agent/${path.relative(root, filePath).split(path.sep).join('/')}`;
        const hook = afterStage;
        afterStage = undefined;
        if (hook !== undefined) await hook();
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            staged: result.staged.map((file) => ({
              path: remap(file.path),
              bytes: file.bytes,
            })),
            skipped: result.skipped.map((file) => ({
              path: remap(file.path),
              reason: file.reason,
            })),
          }),
        );
      };
      void run().catch((error: unknown) => {
        stageFailures.push(error instanceof Error ? error.name : 'unknown');
        response.writeHead(500).end();
      });
    });
  });
  await new Promise<void>((resolve) => spawner.listen(0, '127.0.0.1', resolve));
  const address = spawner.address();
  if (address === null || typeof address === 'string')
    throw new Error('Review fixture spawner did not listen');
  process.env.SANDBOX_URL = `http://127.0.0.1:${address.port}`;
  process.env.SANDBOX_TOKEN = spawnerToken;
  process.env.SANDBOX_HTTP_API_BASE_URL = args.base;
  process.env.TALE_WORKSPACE_ROOT = root;
  const stage = (input: TaskAgentReviewInput, fileId: string) =>
    dispatch(token, {
      operation: 'stage_file',
      taskId: input.taskId,
      expected: input.expected,
      fileId,
    });
  const localFile = (body: Body) =>
    path.join(root, String(output(body).path).slice('/agent/'.length));
  try {
    // A filtered run must not depend on the files-upload lane having seeded
    // the store first. Use the production boot seeder, with fixture env only.
    await ensureDefaultObjectStore(sql, {
      OBJECT_STORE_ENDPOINT: fixtureStore.endpoint,
      OBJECT_STORE_BUCKET: 'itest-blobs',
      OBJECT_STORE_ACCESS_KEY: fixtureStore.accessKeyId,
      OBJECT_STORE_SECRET_KEY: fixtureStore.secretAccessKey,
    });
    const store = await resolveObjectStore(args.orgSlug);
    const key = buildObjectKey(store, args.orgSlug);
    const bytes = Buffer.from([0, 1, 2, 3, 255, 0, 10]);
    await s3PutObject(store, key, bytes, 'application/octet-stream');
    const ref = `s3:${key}`;
    const target = await args.submit('Review binary deliverable bytes');
    const fileId = randomUUID();
    await sql`INSERT INTO app.file_metadata (id, org_id, storage_ref, file_name, content_type, size, created_at_ms)
      VALUES (${fileId}, ${orgId}, ${ref}, 'review.bin', 'application/octet-stream', ${bytes.length}, ${Date.now()})`;
    const entry = {
      fileId,
      fileName: '../../review.bin',
      fileType: 'application/octet-stream',
      fileSize: bytes.length,
      runId: target.runId,
    };
    await sql`UPDATE app.tasks SET outputs = ${sql.json([entry])} WHERE id = ${target.taskId}`;
    const input = await args.inputFor(target.taskId);
    const before = await args.snapshot(target.taskId);
    const read = await dispatch(token, { taskId: target.taskId }, 'task_get');
    const manifest = output(read).reviewFiles;
    record(
      'agent review files: native task_get exposes source-bound metadata with no capability URL',
      read.status === 'ok' &&
        isRecord(manifest) &&
        Array.isArray(manifest.files) &&
        isDeepStrictEqual(manifest.expected, input.expected) &&
        isRecord(manifest.files[0]) &&
        manifest.files[0].fileId === fileId &&
        manifest.files[0].unavailableReason === null &&
        !JSON.stringify(manifest).includes(ref) &&
        !JSON.stringify(manifest).includes('token='),
      `status=${String(read.status)}`,
    );
    const delivered = await stage(input, fileId);
    const deliveredBytes =
      delivered.status === 'ok'
        ? await readFile(localFile(delivered))
        : Buffer.alloc(0);
    record(
      'agent review files: authenticated native staging reaches actual runnerd with exact binary checksum and no task effects',
      delivered.status === 'ok' &&
        checksum(deliveredBytes) === checksum(bytes) &&
        isDeepStrictEqual(before, await args.snapshot(target.taskId)) &&
        isDeepStrictEqual(output(delivered).expected, input.expected),
      `status=${String(delivered.status)} checksumMatches=${checksum(deliveredBytes) === checksum(bytes)} fixtureRoot=${root}`,
    );
    const replay = await stage(input, fileId);
    record(
      'agent review files: repeated staging uses the same source-specific path',
      replay.status === 'ok' &&
        output(replay).path === output(delivered).path &&
        checksum(await readFile(localFile(replay))) === checksum(bytes),
      `status=${String(replay.status)}`,
    );

    const acceptedMetadata = [
      { fileName: 'blank.bin', fileType: '' },
      {
        fileName: 'long-mime.bin',
        fileType: `application/x-${'a'.repeat(241)}`,
      },
      ...[240, 241, 255].map((length) => ({
        fileName: 'a'.repeat(length),
        fileType: 'application/octet-stream',
      })),
      { fileName: 'é'.repeat(121), fileType: 'application/octet-stream' },
      {
        fileName: `${'🦀'.repeat(60)}é.bin`,
        fileType: 'application/octet-stream',
      },
      {
        fileName: `../${'界'.repeat(80)}.bin`,
        fileType: 'application/octet-stream',
      },
      { fileName: `${'界'.repeat(80)}/a.bin`, fileType: '' },
      { fileName: `${'界'.repeat(80)}\\b.bin`, fileType: '' },
      { fileName: 'unknown.bin', fileType: 'unknown' },
    ];
    for (const kind of ['attachment', 'output'] as const) {
      const metadataTask = await args.submit(`Accepted ${kind} metadata`);
      const selectedFiles: TaskAttachmentEntry[] = [];
      for (const [index, display] of acceptedMetadata.entries()) {
        const objectKey = buildObjectKey(store, args.orgSlug);
        const exactBytes = Buffer.concat([bytes, Buffer.from([index])]);
        await s3PutObject(
          store,
          objectKey,
          exactBytes,
          'application/octet-stream',
        );
        const id = randomUUID();
        const storageRef = `s3:${objectKey}`;
        await sql`INSERT INTO app.file_metadata (id, org_id, storage_ref, file_name, content_type, size, uploaded_by, created_at_ms)
          VALUES (${id}, ${orgId}, ${storageRef}, ${display.fileName}, 'application/octet-stream', ${exactBytes.length}, ${args.auth.userId}, ${Date.now()})`;
        selectedFiles.push({
          ...display,
          fileId: storageRef,
          fileSize: exactBytes.length,
        });
      }
      await transactSerializable(sql, async (tx) => {
        if (kind === 'attachment') {
          await updateTask(tx, args.auth, {
            taskId: metadataTask.taskId,
            attachments: selectedFiles,
          });
        } else {
          await agentRecordTaskOutputsTrusted(tx, {
            organizationId: orgId,
            taskId: metadataTask.taskId,
            runId: metadataTask.runId,
            files: selectedFiles,
          });
        }
      });
      const selectedInput = await args.inputFor(metadataTask.taskId);
      const selectedSnapshot = await args.snapshot(metadataTask.taskId);
      const listed = output(
        await dispatch(token, { taskId: metadataTask.taskId }, 'task_get'),
      ).reviewFiles;
      const listedFiles =
        isRecord(listed) && Array.isArray(listed.files) ? listed.files : [];
      const paths = [];
      for (const [index, selected] of selectedFiles.entries()) {
        const listedFile: unknown = listedFiles[index];
        const receipt = await stage(selectedInput, selected.fileId);
        const staged = output(receipt);
        const destination = String(staged.path);
        const leaf = path.basename(destination);
        const actual =
          receipt.status === 'ok'
            ? await readFile(localFile(receipt))
            : Buffer.alloc(0);
        const exactBytes = Buffer.concat([bytes, Buffer.from([index])]);
        record(
          `agent review files: accepted ${kind} metadata ${index} preserves display and exact bytes with a bounded leaf`,
          isRecord(listedFile) &&
            listedFile.unavailableReason === null &&
            listedFile.fileId === selected.fileId &&
            listedFile.fileName === selected.fileName &&
            listedFile.fileType === selected.fileType &&
            listedFile.kind === kind &&
            receipt.status === 'ok' &&
            staged.fileId === selected.fileId &&
            staged.fileName === selected.fileName &&
            staged.fileType === selected.fileType &&
            staged.kind === kind &&
            (kind === 'attachment' || staged.runId === metadataTask.runId) &&
            checksum(actual) === checksum(exactBytes) &&
            staged.bytes === exactBytes.length &&
            Buffer.byteLength(leaf) <= 240 &&
            !/[\\/\x00-\x1f\x7f�]/.test(leaf) &&
            !['', '.', '..'].includes(leaf) &&
            destination.split('/').length === 9,
          `status=${String(receipt.status)} nameUnits=${selected.fileName.length} leafBytes=${Buffer.byteLength(leaf)} checksumMatches=${checksum(actual) === checksum(exactBytes)}`,
        );
        paths.push(destination);
      }
      record(
        `agent review files: ${kind} shared-prefix leaves retain distinct blob destinations and immutable task state`,
        new Set(paths).size === selectedFiles.length &&
          path.basename(paths[8] ?? '') === path.basename(paths[9] ?? '') &&
          isDeepStrictEqual(
            selectedSnapshot,
            await args.snapshot(metadataTask.taskId),
          ),
        `destinations=${new Set(paths).size}`,
      );
    }

    // A task holds the production storage-ref form even after its upload
    // row goes. Retaining those bytes does not recreate metadata authority
    // for the review tool, including a trusted size and document bindings.
    const heldKey = buildObjectKey(store, args.orgSlug);
    const heldRef = `s3:${heldKey}`;
    const heldFileId = randomUUID();
    const heldTask = await args.submit(
      'Review a task-held file after deletion',
    );
    await s3PutObject(store, heldKey, bytes, 'application/octet-stream');
    await sql`INSERT INTO app.file_metadata (id, org_id, storage_ref, file_name, content_type, size, created_at_ms)
      VALUES (${heldFileId}, ${orgId}, ${heldRef}, 'held.bin', 'application/octet-stream', ${bytes.length}, ${Date.now()})`;
    await sql`UPDATE app.tasks SET outputs = ${sql.json([{ ...entry, fileId: heldRef, fileName: 'held.bin', runId: heldTask.runId }])}
      WHERE id = ${heldTask.taskId}`;
    const heldInput = await args.inputFor(heldTask.taskId);
    const heldSnapshot = await args.snapshot(heldTask.taskId);
    const heldStage = await stage(heldInput, heldRef);
    record(
      'agent review files: a listed storage ref with current metadata stages through the native door',
      heldStage.status === 'ok' &&
        checksum(await readFile(localFile(heldStage))) === checksum(bytes),
      `status=${String(heldStage.status)}`,
    );
    await sql.begin((tx) =>
      deleteFile(sql, tx, { organizationId: orgId }, heldFileId),
    );
    const heldRows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.file_metadata
      WHERE org_id = ${orgId} AND storage_ref = ${heldRef}
    `;
    record(
      'agent review files: deleting metadata preserves a task-held object without changing the captured review',
      heldRows[0]?.count === 0 &&
        (await s3HeadObject(store, heldKey)) !== null &&
        isDeepStrictEqual(heldSnapshot, await args.snapshot(heldTask.taskId)),
      `metadataRows=${heldRows[0]?.count ?? -1}`,
    );
    const heldRead = await dispatch(
      token,
      { taskId: heldTask.taskId },
      'task_get',
    );
    const heldManifest = output(heldRead).reviewFiles;
    const callsBeforeMissingMetadata = stageCalls;
    const heldRefusal = await stage(heldInput, heldRef);
    record(
      'agent review files: retained bytes with no metadata stay explicitly unavailable and transfer no bytes',
      heldRead.status === 'ok' &&
        isRecord(heldManifest) &&
        Array.isArray(heldManifest.files) &&
        isRecord(heldManifest.files[0]) &&
        heldManifest.files[0].unavailableReason === 'metadata_missing' &&
        heldRefusal.status === 'invalid_args' &&
        String(heldRefusal.message).startsWith(
          'TASK_REVIEW_FILE_UNAVAILABLE:',
        ) &&
        stageCalls === callsBeforeMissingMetadata &&
        isDeepStrictEqual(heldSnapshot, await args.snapshot(heldTask.taskId)),
      `status=${String(heldRefusal.status)} newStages=${stageCalls - callsBeforeMissingMetadata}`,
    );

    const callsBeforeArchive = stageCalls;
    const foreignKey = `foreign-review-fixture/${randomUUID()}`;
    const foreignRef = `s3:${foreignKey}`;
    await s3PutObject(store, foreignKey, bytes, 'application/octet-stream');
    await sql`INSERT INTO app.file_metadata (id, org_id, storage_ref, file_name, content_type, size, created_at_ms)
      VALUES (${randomUUID()}, ${args.foreignOrgId}, ${foreignRef}, 'foreign.bin', 'application/octet-stream', ${bytes.length}, ${Date.now()})`;
    const deniedTask = await args.submit(
      'Invalid review metadata stays unavailable',
    );
    for (const [reason, sourceFiles] of [
      ['invalid_metadata', [{ ...entry, fileName: 'bad\u0001name' }]],
      ['invalid_metadata', [{ ...entry, fileType: 'text/plain\r\n' }]],
      ['ambiguous_membership', [entry, entry]],
      ['invalid_metadata', [{ ...entry, fileSize: bytes.length - 1 }]],
      ['metadata_missing', [{ ...entry, fileId: foreignRef }]],
    ] as const) {
      await sql`UPDATE app.tasks SET outputs = ${sql.json([...sourceFiles])} WHERE id = ${deniedTask.taskId}`;
      const deniedInput = await args.inputFor(deniedTask.taskId);
      const deniedRead = output(
        await dispatch(token, { taskId: deniedTask.taskId }, 'task_get'),
      ).reviewFiles;
      const deniedFiles =
        isRecord(deniedRead) && Array.isArray(deniedRead.files)
          ? deniedRead.files
          : [];
      const deniedStage = await stage(deniedInput, sourceFiles[0].fileId);
      record(
        `agent review files: ${reason} negative control refuses a staging receipt`,
        isRecord(deniedFiles[0]) &&
          deniedFiles[0].unavailableReason === reason &&
          deniedStage.status === 'invalid_args' &&
          String(deniedStage.message).startsWith(
            'TASK_REVIEW_FILE_UNAVAILABLE:',
          ) &&
          stageCalls === callsBeforeArchive,
        `status=${String(deniedStage.status)} newStages=${stageCalls - callsBeforeArchive}`,
      );
    }
    const oversizedId = randomUUID();
    const oversizedSize = 20 * 1024 * 1024 + 1;
    await sql`INSERT INTO app.file_metadata (id, org_id, storage_ref, file_name, content_type, size, created_at_ms)
      VALUES (${oversizedId}, ${orgId}, ${ref}, 'large.bin', 'application/octet-stream', ${oversizedSize}, ${Date.now()})`;
    await sql`UPDATE app.tasks SET outputs = ${sql.json([{ ...entry, fileId: oversizedId, fileSize: oversizedSize }])} WHERE id = ${deniedTask.taskId}`;
    const oversizedInput = await args.inputFor(deniedTask.taskId);
    const oversizedRead = output(
      await dispatch(token, { taskId: deniedTask.taskId }, 'task_get'),
    ).reviewFiles;
    const oversizedFiles =
      isRecord(oversizedRead) && Array.isArray(oversizedRead.files)
        ? oversizedRead.files
        : [];
    const oversizedStage = await stage(oversizedInput, oversizedId);
    record(
      'agent review files: the 20 MiB metadata ceiling still refuses before transfer',
      isRecord(oversizedFiles[0]) &&
        oversizedFiles[0].unavailableReason === 'too_large' &&
        oversizedStage.status === 'invalid_args' &&
        stageCalls === callsBeforeArchive,
      `status=${String(oversizedStage.status)} newStages=${stageCalls - callsBeforeArchive}`,
    );
    await sql`UPDATE app.tasks SET archived_at_ms = ${Date.now()} WHERE id = ${target.taskId}`;
    const archived = await stage(input, fileId);
    await sql`UPDATE app.tasks SET archived_at_ms = NULL WHERE id = ${target.taskId}`;
    record(
      'agent review files: an archived task transfers no bytes',
      archived.status === 'invalid_args' &&
        String(archived.message).startsWith('TASK_ARCHIVED:') &&
        stageCalls === callsBeforeArchive,
      `status=${String(archived.status)} newStages=${stageCalls - callsBeforeArchive}`,
    );
    const callsBefore = stageCalls;
    const other = await stage(input, randomUUID());
    await sql`UPDATE app.project_agents SET tools = ARRAY['task_get']::text[] WHERE id = ${args.reviewerId}`;
    const revoked = await stage(input, fileId);
    await sql`UPDATE app.project_agents SET tools = ARRAY['task_get', 'task_review']::text[] WHERE id = ${args.reviewerId}`;
    record(
      'agent review files: an arbitrary file id and revoked current grant transfer no bytes',
      other.status === 'invalid_args' &&
        revoked.status === 'invalid_args' &&
        String(revoked.message).includes('TASK_REVIEW_FORBIDDEN') &&
        stageCalls === callsBefore,
      `unlisted=${String(other.status)} revoked=${String(revoked.status)} newStages=${stageCalls - callsBefore}`,
    );

    const bindingId = randomUUID();
    await sql`INSERT INTO app.file_metadata (id, org_id, storage_ref, document_id, file_name, content_type, size, created_at_ms)
      VALUES (${bindingId}, ${orgId}, ${ref}, ${randomUUID()}, 'protected.bin', 'application/octet-stream', ${bytes.length}, ${Date.now()})`;
    const protectedRead = await dispatch(
      token,
      { taskId: target.taskId },
      'task_get',
    );
    const protectedStage = await stage(input, fileId);
    const protectedManifest = output(protectedRead).reviewFiles;
    record(
      'agent review files: a document binding on another ledger row for the blob retains ACL precedence',
      isRecord(protectedManifest) &&
        Array.isArray(protectedManifest.files) &&
        isRecord(protectedManifest.files[0]) &&
        protectedManifest.files[0].unavailableReason ===
          'document_access_required' &&
        protectedStage.status === 'invalid_args' &&
        stageCalls === callsBefore,
      `status=${String(protectedStage.status)}`,
    );
    await sql`UPDATE app.file_metadata SET document_id = NULL WHERE id = ${bindingId}`;

    // Source metadata still declares the old seven bytes, but the object
    // serves eight. The signed cap must refuse the oversized declaration; the
    // daemon buffers before write, preserving the already-staged old file.
    await s3PutObject(
      store,
      key,
      Buffer.concat([bytes, Buffer.from([8])]),
      'application/octet-stream',
    );
    const tooLarge = await stage(input, fileId);
    const retained = await readFile(localFile(delivered));
    record(
      'agent review files: oversized actual object refuses success and leaves the prior destination intact',
      tooLarge.status === 'invalid_args' &&
        String(tooLarge.message).includes('TASK_REVIEW_FILE_UNAVAILABLE') &&
        checksum(retained) === checksum(bytes),
      `status=${String(tooLarge.status)} retainedChecksum=${checksum(retained) === checksum(bytes)}`,
    );
    for (const size of [0, bytes.length - 1]) {
      await s3PutObject(
        store,
        key,
        bytes.subarray(0, size),
        'application/octet-stream',
      );
      const tooShort = await stage(input, fileId);
      const previousBytes = await readFile(localFile(delivered));
      record(
        `agent review files: clean ${size}-byte object refuses success and preserves prior complete bytes`,
        tooShort.status === 'invalid_args' &&
          String(tooShort.message).includes('TASK_REVIEW_FILE_UNAVAILABLE') &&
          checksum(previousBytes) === checksum(bytes),
        `status=${String(tooShort.status)} retainedChecksum=${checksum(previousBytes) === checksum(bytes)}`,
      );
    }
    await s3PutObject(store, key, bytes, 'application/octet-stream');

    afterStage = () => args.transferToHuman(target.taskId);
    const raced = await stage(input, fileId);
    const staleDecision = await dispatch(token, input);
    record(
      'agent review files: explicit handoff during transfer refuses current success and a stale verdict, retaining historical bytes',
      raced.status === 'invalid_args' &&
        String(raced.message).startsWith('TASK_REVIEW_STALE:') &&
        staleDecision.status === 'invalid_args' &&
        String(staleDecision.message).startsWith('TASK_REVIEW_STALE:') &&
        checksum(await readFile(localFile(delivered))) === checksum(bytes),
      `stage=${String(raced.status)}/${String(raced.message)} verdict=${String(staleDecision.status)}/${String(staleDecision.message)}`,
    );

    const paged = await args.submit('Review files beyond one page');
    const entries = [];
    for (let index = 0; index < 61; index += 1) {
      const id = randomUUID();
      await sql`INSERT INTO app.file_metadata (id, org_id, storage_ref, file_name, content_type, size, created_at_ms)
        VALUES (${id}, ${orgId}, ${ref}, ${`file-${index}.bin`}, 'application/octet-stream', ${bytes.length}, ${Date.now()})`;
      entries.push({
        ...entry,
        fileId: id,
        fileName: `file-${index}.bin`,
        runId: paged.runId,
      });
    }
    await sql`UPDATE app.tasks SET outputs = ${sql.json(entries)} WHERE id = ${paged.taskId}`;
    const first = output(
      await dispatch(token, { taskId: paged.taskId }, 'task_get'),
    ).reviewFiles;
    const firstPage = isRecord(first) && isRecord(first.page) ? first.page : {};
    const second = output(
      await dispatch(
        token,
        { taskId: paged.taskId, reviewFileCursor: firstPage.continueCursor },
        'task_get',
      ),
    ).reviewFiles;
    record(
      'agent review files: native manifest reaches every stored output beyond fifty without inventing a run',
      isRecord(first) &&
        Array.isArray(first.files) &&
        first.files.length === 50 &&
        firstPage.isDone === false &&
        isRecord(second) &&
        Array.isArray(second.files) &&
        second.files.length === 11 &&
        isRecord(second.page) &&
        second.page.isDone === true &&
        [...first.files, ...second.files].every(
          (file) => isRecord(file) && file.runId === paged.runId,
        ),
      `first=${isRecord(first) && Array.isArray(first.files) ? first.files.length : 0} second=${isRecord(second) && Array.isArray(second.files) ? second.files.length : 0}`,
    );
    await sql`UPDATE app.tasks SET description = 'Changed evidence' WHERE id = ${paged.taskId}`;
    const stalePage = await dispatch(
      token,
      { taskId: paged.taskId, reviewFileCursor: firstPage.continueCursor },
      'task_get',
    );
    record(
      'agent review files: an old manifest cursor cannot cross an evidence revision',
      stalePage.status === 'invalid_args' &&
        String(stalePage.message).includes('TASK_REVIEW_INVALID'),
      `status=${String(stalePage.status)}`,
    );
    record(
      'agent review files: inert spawner fixture had no handler failures',
      stageFailures.length === 0,
      `failures=${stageFailures.length}`,
    );
  } finally {
    for (const [name, value] of prior) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await new Promise<void>((resolve) => spawner.close(() => resolve()));
    // Preserve the fixture workspace and bytes for inspection. No local
    // inputs, blob objects, or other sandbox state are deleted by this lane.
  }
}
