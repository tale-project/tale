/** Local authenticated HTTP + real Postgres proof of source projection. These
 * synthetic business tickets run no model, agent, provider or external source. */
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import {
  externalStatusDecisionSchema,
  externalStatusWorkflowSchema,
} from '@tale/shared/schemas/task-external-status';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { getProjectAuthContext } from '../projects/service.ts';
import {
  fixtures,
  type LaneCtx,
  type Recorder,
} from './delegated-start.integration.ts';
import { readTaskStatusSnapshot } from './external-status.ts';
import { getPendingReviewForTask } from './reviews.ts';
import { archiveTask, loadTaskOrThrow, updateTaskStatus } from './service.ts';

const snapshotSchema = z.object({
  task: z.object({
    id: z.string(),
    status: z.string(),
    archivedAt: z.number().optional(),
  }),
  revision: z.string(),
  statusChangedAt: z.number().nullable(),
  change: z
    .object({
      origin: z.enum(['native', 'external']),
      id: z.string(),
      actor: z.object({
        type: z.string(),
        userId: z.string(),
        email: z.string().optional(),
        emailVerified: z.boolean(),
        activeMember: z.boolean(),
      }),
    })
    .nullable(),
  externalStatus: z
    .object({
      sourceRevision: z.string(),
      sourceStatusAt: z.number(),
      status: z.string(),
      archived: z.boolean(),
    })
    .nullable(),
  workflow: externalStatusWorkflowSchema.nullable(),
  request: z
    .object({
      id: z.string(),
      revision: z.string(),
      statusChangeId: z.string(),
      actionId: z.string(),
      status: z.string(),
      input: z.record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean()]),
      ),
      sourceRevision: z.string(),
      sourceStatusAt: z.number(),
      actor: z.object({
        type: z.string(),
        userId: z.string(),
        email: z.string().optional(),
        emailVerified: z.boolean(),
        activeMember: z.boolean(),
      }),
      decision: externalStatusDecisionSchema.nullable(),
    })
    .nullable(),
});

export async function checkTaskExternalStatusProjection(
  sql: Sql,
  base: string,
  ctx: LaneCtx,
  record: Recorder,
): Promise<void> {
  const fx = fixtures(sql, ctx);
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const personId = `source-person-${fx.suffix}`;
  const source = 'quality-service';
  await fx.insertProject(projectId, 'Accepted source lifecycle proof');
  await fx.insertProject(otherProjectId, 'Source visibility proof');
  await fx.insertUser(personId, 'editor');
  const auth = await getProjectAuthContext(sql, {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    role: 'owner',
  });
  const personAuth = await getProjectAuthContext(
    sql,
    { organizationId: ctx.orgId, userId: personId, role: 'editor' },
    `${personId}@example.com`,
  );
  const orgs = await sql<
    { slug: string }[]
  >`SELECT slug FROM "organization" WHERE id = ${ctx.orgId}`;
  const minted = await fetch(`${base}/api/auth/api-key/create`, {
    method: 'POST',
    headers: {
      cookie: ctx.cookie,
      origin: base,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: `source-projection-${fx.suffix}` }),
  });
  if (!minted.ok)
    throw new Error(
      `Source lifecycle key creation failed: HTTP ${minted.status}`,
    );
  const key = z.object({ key: z.string() }).parse(await minted.json());
  const headers = {
    authorization: `Bearer ${key.key}`,
    'x-organization-slug': orgs[0]?.slug ?? '',
    'content-type': 'application/json',
  };
  const collection = `/api/v1/projects/${projectId}/tasks`;
  const call = async (route: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // Refusal bodies are part of this HTTP proof, so retain their status too.
    const status = response.status;
    const value: unknown = await response.json();
    return { status, value };
  };
  const state = async (taskId: string) => {
    const response = await call(`${collection}/${taskId}/status`);
    if (response.status !== 200)
      throw new Error(`Source lifecycle read failed: HTTP ${response.status}`);
    return snapshotSchema.parse(response.value);
  };
  const create = async (ref: string) => {
    const response = await call(collection, 'POST', {
      externalSystem: source,
      externalId: ref,
      title: 'Business improvement',
    });
    if (response.status !== 201)
      throw new Error(
        `Source lifecycle intake failed: HTTP ${response.status}`,
      );
    return z
      .object({ task: z.object({ id: z.string() }) })
      .parse(response.value).task.id;
  };
  const code = (response: { value: unknown }) =>
    z.object({ code: z.string() }).parse(response.value).code;
  const project = (taskId: string, body: unknown) =>
    call(`${collection}/${taskId}/external-status`, 'PUT', body);
  const nativeCall = async (taskId: string, body?: unknown, session = true) => {
    const response = await fetch(
      `${base}/api/app/tasks/${taskId}/${body === undefined ? 'external-status' : 'external-status-request'}?orgId=${ctx.orgId}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(session
            ? { cookie: ctx.cookie }
            : { authorization: headers.authorization }),
          origin: base,
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    const status = response.status;
    const value: unknown = await response.json();
    return { status, value };
  };
  const verification = await sql<
    { verified: boolean }[]
  >`SELECT "emailVerified" AS verified FROM "user" WHERE id = ${ctx.userId}`;
  try {
    const taskId = await create('ticket:7');
    const first = await state(taskId);
    const comment = await call(`${collection}/${taskId}/comments`, 'POST', {
      body: 'Keep this discussion while syncing.',
    });
    await sql`UPDATE app.tasks SET assignee_type = 'user', assignee_id = ${personId} WHERE id = ${taskId}`;
    const initialInput = {
      externalSystem: source,
      externalId: 'ticket:7',
      expectedRevision: first.revision,
      sourceRevision: 'accepted:1',
      sourceStatusAt: 100,
      status: 'in_review',
      archived: false,
    };
    const accepted = await project(taskId, initialInput);
    const reviewing = snapshotSchema.parse(accepted.value);
    record(
      'external status: accepted projection preserves discussion and assignee without a second review [TASK-R14] [TASK-R15]',
      accepted.status === 200 &&
        comment.status === 201 &&
        reviewing.task.status === 'in_review' &&
        reviewing.change?.origin === 'external' &&
        (await getPendingReviewForTask(sql, ctx.orgId, taskId)) === null &&
        (await loadTaskOrThrow(sql, taskId, ctx.orgId)).assigneeId ===
          personId &&
        (await loadTaskOrThrow(sql, taskId, ctx.orgId)).commentCount === 1,
      `HTTP ${accepted.status}, status=${reviewing.task.status}, origin=${reviewing.change?.origin}`,
    );

    const closedInput = {
      ...initialInput,
      expectedRevision: reviewing.revision,
      sourceRevision: 'accepted:2',
      sourceStatusAt: 101,
      status: 'done',
    };
    const closed = await project(taskId, closedInput);
    const closedState = snapshotSchema.parse(closed.value);
    const repeat = await project(taskId, closedInput);
    record(
      'external status: Done records source evidence and lost-reply replay changes no revision [TASK-R15] [TASK-R16]',
      closed.status === 200 &&
        closedState.task.status === 'done' &&
        repeat.status === 200 &&
        snapshotSchema.parse(repeat.value).revision === closedState.revision,
      `closed=${closed.status}, replay=${repeat.status}, revision=${closedState.revision}`,
    );

    const refreshed = await call(collection, 'POST', {
      externalSystem: source,
      externalId: 'ticket:7',
      title: 'Refreshed source title',
    });
    const afterRefresh = await state(taskId);
    record(
      'external status: ordinary metadata intake cannot reopen source-approved Done [TASK-R17]',
      refreshed.status === 200 &&
        afterRefresh.task.status === 'done' &&
        afterRefresh.revision === closedState.revision,
      `status=${afterRefresh.task.status}, revision unchanged=${afterRefresh.revision === closedState.revision}`,
    );

    const old = await project(taskId, {
      ...closedInput,
      expectedRevision: afterRefresh.revision,
      sourceStatusAt: 99,
    });
    const conflictAtSameTime = await project(taskId, {
      ...closedInput,
      expectedRevision: afterRefresh.revision,
      sourceRevision: 'accepted:other',
      status: 'todo',
    });
    record(
      'external status: stale and same-time conflicting source lifecycles are refused [TASK-R17]',
      old.status === 409 &&
        code(old) === 'TASK_EXTERNAL_STATUS_STALE' &&
        conflictAtSameTime.status === 409 &&
        code(conflictAtSameTime) === 'TASK_EXTERNAL_STATUS_STALE',
      `old=${old.status}, same-time=${conflictAtSameTime.status}`,
    );

    await transactSerializable(sql, (tx) =>
      updateTaskStatus(tx, personAuth, taskId, 'todo'),
    );
    await transactSerializable(sql, (tx) =>
      updateTaskStatus(tx, personAuth, taskId, 'done'),
    );
    const native = await state(taskId);
    const oldReplay = await project(taskId, closedInput);
    record(
      'external status: a newer native move back to the same column still protects its revision [TASK-R16] [TASK-R18]',
      native.change?.origin === 'native' &&
        native.change.actor.userId === personId &&
        native.change.actor.email === `${personId}@example.com` &&
        oldReplay.status === 409 &&
        code(oldReplay) === 'TASK_STATUS_CONFLICT',
      `native=${native.change?.origin}, replay=${oldReplay.status}`,
    );
    await fx.setRole(personId, 'disabled');
    const inactive = await state(taskId);
    record(
      'external status: disabled native actor has no relayed verified address [TASK-R18]',
      inactive.change?.actor.userId === personId &&
        !inactive.change.actor.activeMember &&
        inactive.change.actor.email === undefined,
      `active=${inactive.change?.actor.activeMember}, email present=${inactive.change?.actor.email !== undefined}`,
    );
    await fx.setRole(personId, 'editor');
    await sql`UPDATE "user" SET "emailVerified" = false WHERE id = ${personId}`;
    const unverified = await state(taskId);
    record(
      'external status: unverified native actor has no relayed address [TASK-R18]',
      unverified.change?.actor.emailVerified === false &&
        unverified.change.actor.email === undefined,
      `verified=${unverified.change?.actor.emailVerified}`,
    );
    await sql`UPDATE "user" SET "emailVerified" = true WHERE id = ${personId}`;

    const settle = await project(taskId, {
      ...closedInput,
      expectedRevision: native.revision,
    });
    record(
      'external status: freshly validated native intent can be reconciled [TASK-R16]',
      settle.status === 200 &&
        snapshotSchema.parse(settle.value).change?.origin === 'external',
      `HTTP ${settle.status}`,
    );

    const mismatched = await project(taskId, {
      ...closedInput,
      externalId: 'ticket:8',
      expectedRevision: (await state(taskId)).revision,
    });
    const otherPath = await call(
      `/api/v1/projects/${otherProjectId}/tasks/${taskId}/status`,
    );
    let foreignCode: string | null = null;
    try {
      await readTaskStatusSnapshot(sql, randomUUID(), taskId);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string'
      )
        foreignCode = error.code;
      else throw error;
    }
    record(
      'external status: exact reference, project and organization boundaries hold [TASK-R14]',
      mismatched.status === 409 &&
        code(mismatched) === 'TASK_EXTERNAL_REF_INVALID' &&
        otherPath.status === 404 &&
        code(otherPath) === 'TASK_NOT_FOUND' &&
        foreignCode === 'TASK_NOT_FOUND',
      `binding=${mismatched.status}, path=${otherPath.status}, foreign=${foreignCode}`,
    );

    const archivedId = await create('ticket:archived');
    await transactSerializable(sql, (tx) => archiveTask(tx, auth, archivedId));
    const archiveBefore = await state(archivedId);
    const archiveClose = await project(archivedId, {
      ...closedInput,
      externalId: 'ticket:archived',
      expectedRevision: archiveBefore.revision,
      archived: true,
    });
    const archiveAfter = snapshotSchema.parse(archiveClose.value);
    record(
      'external status: an archived task closes atomically without temporary restoration [TASK-R14]',
      archiveClose.status === 200 &&
        archiveAfter.task.status === 'done' &&
        archiveAfter.task.archivedAt === archiveBefore.task.archivedAt,
      `HTTP ${archiveClose.status}, archive unchanged=${archiveAfter.task.archivedAt === archiveBefore.task.archivedAt}`,
    );

    const humanId = await create('ticket:human-review');
    await transactSerializable(sql, (tx) =>
      updateTaskStatus(tx, auth, humanId, 'in_review'),
    );
    const pendingHuman = await getPendingReviewForTask(sql, ctx.orgId, humanId);
    const humanClose = await project(humanId, {
      ...closedInput,
      externalId: 'ticket:human-review',
      expectedRevision: (await state(humanId)).revision,
    });
    const approvals = await sql<
      { status: string; approvedBy: string | null }[]
    >`SELECT status, approved_by AS "approvedBy" FROM app.approvals WHERE id = ${pendingHuman?.approvalId ?? ''}`;
    record(
      'external status: external closure withdraws a native human gate without claiming approval [TASK-R15]',
      pendingHuman !== null &&
        humanClose.status === 200 &&
        approvals[0]?.status === 'rejected' &&
        approvals[0].approvedBy === null,
      `HTTP ${humanClose.status}, gate=${approvals[0]?.status}, approver=${approvals[0]?.approvedBy}`,
    );

    const agentId = await create('ticket:agent-review');
    await sql`UPDATE app.tasks SET status = 'in_review' WHERE id = ${agentId}`;
    const approvalId = randomUUID();
    const capturedReviewer = randomUUID();
    await fx.insertAgent(
      capturedReviewer,
      projectId,
      'Captured independent reviewer',
    );
    await sql`INSERT INTO app.approvals (id, org_id, resource_type, resource_id, priority, status, metadata, created_at_ms)
      VALUES (${approvalId}, ${ctx.orgId}, 'task_review', ${agentId}, 'high', 'pending', ${sql.json({ reviewer: { kind: 'agent', agentId: capturedReviewer }, taskId: agentId, projectId, round: 0 })}, ${Date.now()})`;
    const protectedReview = await project(agentId, {
      ...closedInput,
      externalId: 'ticket:agent-review',
      expectedRevision: (await state(agentId)).revision,
    });
    record(
      'external status: a captured native agent review cannot be superseded [TASK-R15]',
      protectedReview.status === 409 &&
        code(protectedReview) === 'TASK_AGENT_REVIEW_REQUIRED' &&
        (await getPendingReviewForTask(sql, ctx.orgId, agentId))?.approvalId ===
          approvalId &&
        (await loadTaskOrThrow(sql, agentId, ctx.orgId)).status === 'in_review',
      `HTTP ${protectedReview.status}, code=${code(protectedReview)}`,
    );

    const raceId = await create('ticket:race');
    const raceBefore = await state(raceId);
    let release: (() => void) | undefined;
    let locked: (() => void) | undefined;
    const holding = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const move = transactSerializable(sql, async (tx) => {
      await tx`SELECT id FROM app.tasks WHERE id = ${raceId} AND org_id = ${ctx.orgId} FOR UPDATE`;
      locked?.();
      await holding;
      await updateTaskStatus(tx, personAuth, raceId, 'cancelled');
    });
    await ready;
    const racingProjection = project(raceId, {
      ...closedInput,
      externalId: 'ticket:race',
      expectedRevision: raceBefore.revision,
    });
    setTimeout(() => release?.(), 100);
    const [, raced] = await Promise.all([move, racingProjection]);
    const raceAfter = await state(raceId);
    record(
      'external status: projection waiting behind a native move refuses its stale snapshot [TASK-R16]',
      raced.status === 409 &&
        code(raced) === 'TASK_STATUS_CONFLICT' &&
        raceAfter.task.status === 'cancelled' &&
        raceAfter.change?.origin === 'native',
      `projection=${raced.status}, status=${raceAfter.task.status}`,
    );

    const forged = await project(taskId, {
      ...closedInput,
      actor: { email: `${personId}@example.com` },
    });
    record(
      'external status: accepted projection refuses a forged native person claim [TASK-R14]',
      forged.status === 400 && code(forged) === 'INVALID_BODY',
      `HTTP ${forged.status}`,
    );

    await sql`UPDATE "user" SET "emailVerified" = true WHERE id = ${ctx.userId}`;
    const formId = await create('ticket:forms');
    const workflow = {
      actions: [
        {
          id: 'verify',
          title: 'Verify first result',
          status: 'in_review',
          fields: [
            {
              key: 'note',
              label: 'Verification result',
              type: 'text',
              required: true,
              multiline: true,
              pattern: '^[\\s\\S]{1,2000}$',
            },
            {
              key: 'successful',
              label: 'Successful',
              type: 'boolean',
              required: true,
            },
          ],
        },
        {
          id: 'close',
          title: 'Close with evidence',
          status: 'done',
          fields: [
            {
              key: 'note',
              label: 'Closure evidence',
              type: 'text',
              required: true,
            },
          ],
        },
        {
          id: 'reopen',
          title: 'Reopen',
          status: 'in_review',
          fields: [
            {
              key: 'reason',
              label: 'Reopening reason',
              type: 'text',
              required: true,
            },
          ],
        },
      ],
    };
    const formInput = {
      ...initialInput,
      externalId: 'ticket:forms',
      expectedRevision: (await state(formId)).revision,
      sourceRevision: 'form:1',
      sourceStatusAt: 200,
      workflow,
    };
    const declared = await project(formId, formInput);
    const formBefore = snapshotSchema.parse(declared.value);
    const nativeBefore = await nativeCall(formId);
    const requestBody = {
      requestId: randomUUID(),
      expectedRevision: formBefore.revision,
      expectedSourceRevision: 'form:1',
      actionId: 'verify',
      values: {
        note: 'Checked the first result.\nEvidence retained.',
        successful: 'true',
      },
    };
    const noSession = await nativeCall(formId, requestBody, false);
    const keyHandoff = await fetch(
      `${base}/api/app/tasks/${formId}/external-status-request?orgId=${ctx.orgId}`,
      {
        method: 'POST',
        headers: {
          'x-api-key': key.key,
          origin: base,
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      },
    );
    const forgedSession = await nativeCall(formId, {
      ...requestBody,
      actor: { userId: personId },
    });
    const invalidValues = await nativeCall(formId, {
      ...requestBody,
      values: { note: 'x'.repeat(2001), successful: 'true' },
    });
    const submitted = await nativeCall(formId, requestBody);
    const requested = snapshotSchema.parse(submitted.value);
    record(
      'external status: native session owns immutable same-column action and declared field validation [TASK-R19]',
      declared.status === 200 &&
        nativeBefore.status === 200 &&
        noSession.status === 401 &&
        keyHandoff.status === 401 &&
        forgedSession.status === 400 &&
        invalidValues.status === 400 &&
        submitted.status === 200 &&
        requested.task.status === 'in_review' &&
        requested.revision !== formBefore.revision &&
        requested.change?.id === formBefore.change?.id &&
        requested.request?.id === requestBody.requestId &&
        requested.request.statusChangeId === formBefore.change?.id &&
        requested.request.actor.userId === ctx.userId &&
        requested.request.actor.emailVerified &&
        requested.request.actor.activeMember &&
        requested.request.input.successful === true &&
        requested.request.input.note === requestBody.values.note,
      `key=${noSession.status}, forged=${forgedSession.status}, fields=${invalidValues.status}, submit=${submitted.status}, same-column=${requested.task.status}`,
    );
    const submissionReplay = await nativeCall(formId, requestBody);
    const changedReplay = await nativeCall(formId, {
      ...requestBody,
      values: { ...requestBody.values, note: 'Changed after submission' },
    });
    const secondPending = await nativeCall(formId, {
      ...requestBody,
      requestId: randomUUID(),
      expectedRevision: requested.revision,
    });
    record(
      'external status: lost native submit replays once; changed id payload and a second pending action refuse [TASK-R20]',
      submissionReplay.status === 200 &&
        snapshotSchema.parse(submissionReplay.value).revision ===
          requested.revision &&
        changedReplay.status === 409 &&
        secondPending.status === 409,
      `replay=${submissionReplay.status}, changed=${changedReplay.status}, pending=${secondPending.status}`,
    );
    const acceptBody = {
      ...formInput,
      expectedRevision: requested.revision,
      sourceRevision: 'form:2',
      sourceStatusAt: 201,
      requestId: requestBody.requestId,
      decision: { accepted: true },
    };
    const acceptedForm = await project(formId, acceptBody);
    const formAccepted = snapshotSchema.parse(acceptedForm.value);
    const repeatedDecision = await project(formId, acceptBody);
    const contradictDecision = await project(formId, {
      ...acceptBody,
      expectedRevision: formAccepted.revision,
      decision: { accepted: false, reason: 'Changed decision' },
    });
    record(
      'external status: source settles exact request durably, without a native reviewer or repeated transition [TASK-R20]',
      acceptedForm.status === 200 &&
        formAccepted.request?.decision?.accepted === true &&
        repeatedDecision.status === 200 &&
        snapshotSchema.parse(repeatedDecision.value).revision ===
          formAccepted.revision &&
        contradictDecision.status === 409 &&
        (await getPendingReviewForTask(sql, ctx.orgId, formId)) === null,
      `accepted=${acceptedForm.status}, replay=${repeatedDecision.status}, contradiction=${contradictDecision.status}`,
    );
    const closureBody = {
      requestId: randomUUID(),
      expectedRevision: formAccepted.revision,
      expectedSourceRevision: 'form:2',
      actionId: 'close',
      values: { note: 'Closure evidence' },
    };
    const closureRequested = snapshotSchema.parse(
      (await nativeCall(formId, closureBody)).value,
    );
    const lateOlder = await project(formId, {
      ...acceptBody,
      expectedRevision: closureRequested.revision,
    });
    const afterOlder = snapshotSchema.parse(lateOlder.value);
    record(
      'external status: delayed older accepted decision cannot replace or obsolete newer pending form [TASK-R20]',
      lateOlder.status === 200 &&
        afterOlder.request?.id === closureBody.requestId &&
        afterOlder.request.decision === null &&
        afterOlder.revision === closureRequested.revision,
      `HTTP ${lateOlder.status}, newer request=${afterOlder.request?.id === closureBody.requestId}, unchanged revision=${afterOlder.revision === closureRequested.revision}`,
    );
    const refusal = await project(formId, {
      ...acceptBody,
      expectedRevision: afterOlder.revision,
      requestId: closureBody.requestId,
      decision: {
        accepted: false,
        reason: 'Only the designated source reviewer may close this record.',
      },
    });
    const refused = snapshotSchema.parse(refusal.value);
    record(
      'external status: source refusal keeps accepted status and exposes its explanation [TASK-R19] [TASK-R20]',
      refusal.status === 200 &&
        refused.task.status === 'in_review' &&
        refused.request?.decision?.accepted === false &&
        refused.request.decision.reason?.includes(
          'designated source reviewer',
        ) === true,
      `HTTP ${refusal.status}, accepted=${refused.request?.decision?.accepted}`,
    );
    const staleForm = await nativeCall(formId, {
      ...closureBody,
      requestId: randomUUID(),
      expectedRevision: refused.revision,
      expectedSourceRevision: 'form:1',
    });
    await sql`UPDATE "user" SET "emailVerified" = false WHERE id = ${ctx.userId}`;
    const unverifiedForm = await nativeCall(formId, {
      ...closureBody,
      requestId: randomUUID(),
      expectedRevision: refused.revision,
    });
    await sql`UPDATE "user" SET "emailVerified" = true WHERE id = ${ctx.userId}`;
    record(
      'external status: stale source form and revoked email verification fail closed [TASK-R19]',
      staleForm.status === 409 && unverifiedForm.status === 403,
      `stale=${staleForm.status}, unverified=${unverifiedForm.status}`,
    );
    const archivedForm = await project(formId, {
      ...acceptBody,
      expectedRevision: refused.revision,
      requestId: undefined,
      decision: undefined,
      sourceRevision: 'form:closed',
      sourceStatusAt: 202,
      status: 'done',
      archived: true,
    });
    const archiveFormState = snapshotSchema.parse(archivedForm.value);
    const reopenBody = {
      requestId: randomUUID(),
      expectedRevision: archiveFormState.revision,
      expectedSourceRevision: 'form:closed',
      actionId: 'reopen',
      values: { reason: 'Additional evidence requires reopening.' },
    };
    const reopen = await nativeCall(formId, reopenBody);
    const reopenRequest = snapshotSchema.parse(reopen.value);
    await transactSerializable(sql, (tx) => archiveTask(tx, auth, taskId));
    const archivedNative = await state(taskId);
    record(
      'external status: guarded reopen intent works while archived and archive keeps status actor provenance [TASK-R18] [TASK-R19]',
      archivedForm.status === 200 &&
        reopen.status === 200 &&
        reopenRequest.task.archivedAt === archiveFormState.task.archivedAt &&
        reopenRequest.request?.input.reason === reopenBody.values.reason &&
        archivedNative.revision !== (await state(taskId)).change?.id,
      `archive=${archivedForm.status}, reopen request=${reopen.status}`,
    );
  } finally {
    if (verification[0] !== undefined)
      await sql`UPDATE "user" SET "emailVerified" = ${verification[0].verified} WHERE id = ${ctx.userId}`;
    await fx.teardownUsers();
  }
}
