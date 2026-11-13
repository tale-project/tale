import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs';
import { lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { preconditionError } from '../../../../utils/fail';
import { sha } from '../../../config/releases/model';
import {
  readOptionalJson,
  writePrivateJson,
} from '../../../state/private-files';
import { incusStateDirectory } from '../plan/digest';
import { INCUS_PLAN_ACTIONS } from '../plan/plan-model';

/**
 * The Incus runtime's journal, `<state>/.tale/incus/runtime.json` (design
 * D-07, D-12): what the last apply was doing, so an interrupted run can be
 * told apart from a finished one, and what a crash may have left behind.
 *
 * - `phase`: `pending` while an apply runs, `ready` once it finished,
 *   `interrupted` when SIGINT stopped it. Nothing is cleaned up on the
 *   signal: the next run plans again from what the node holds.
 * - `payloads`: exec payload files pushed into `/dev/shm` (R3-06), reaped by
 *   the next run if a crash left one.
 * - `withdrawn`: withdrawal markers set on replicas (R3-02), so a replica a
 *   crash left withdrawn but kept is admitted again.
 * - `restorePending` (R3-22): a restore that has not finished. While it is
 *   set, every verb that could make a missing volume empty refuses, and only
 *   `tale restore --resume` or `--abort` clears it.
 *
 * The caller holds the deploy lock; the journal is written whole, atomically,
 * 0600.
 */

const JOURNAL_FILE = 'runtime.json';
const INCUS_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const name = z.string().regex(INCUS_NAME);

/** The steps of one volume's restore aside, in order (design D-29). */
export const RESTORE_STEPS = [
  'pending',
  'stopped',
  'detached',
  'renamed',
  'copied',
  'attached',
  'started',
] as const;
export const restorePendingSchema = z
  .strictObject({
    /** The snapshot being restored. */
    id: z.string().min(1).max(128),
    startedAt: z.string().datetime(),
    volumes: z.array(name).min(1).max(64),
    /** How far each volume got. */
    steps: z.record(name, z.enum(RESTORE_STEPS)),
    /** Each volume's holder of what it replaced (`<v>.pre-restore-<ts>`). */
    holders: z.record(name, name),
    /** The disk devices each volume was attached as, so a restore that
     * detached them can attach them again after a crash. */
    attachments: z
      .record(
        name,
        z
          .array(
            z.strictObject({
              instance: name,
              device: name,
              path: z.string().regex(/^\/[A-Za-z0-9._/-]{0,255}$/),
              readonly: z.boolean(),
            }),
          )
          .max(64),
      )
      .optional(),
    /** The volume users that ran before the restore stopped them; they are
     * started again at its end. */
    running: z.array(name).max(256).optional(),
  })
  .superRefine((value, context) => {
    const volumes = new Set(value.volumes);
    for (const volume of value.volumes)
      if (value.steps[volume] === undefined)
        context.addIssue({
          code: 'custom',
          message: `restore-pending has no step for ${volume}`,
        });
    for (const volume of [
      ...Object.keys(value.steps),
      ...Object.keys(value.holders),
      ...Object.keys(value.attachments ?? {}),
    ])
      if (!volumes.has(volume))
        context.addIssue({
          code: 'custom',
          message: `restore-pending names ${volume} outside its volumes`,
        });
  });
export type RestorePending = z.infer<typeof restorePendingSchema>;
export type RestoreStep = (typeof RESTORE_STEPS)[number];

export const journalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  stack: z.string().min(1).max(128),
  phase: z.enum(['pending', 'ready', 'interrupted']),
  /** The keyed digest of the plan the apply ran, or null. */
  planSha256: sha.nullable(),
  updatedAt: z.string().datetime(),
  /** The resources the current apply finished, in order. */
  steps: z
    .array(
      z.strictObject({
        id: z.string().min(3).max(1024),
        action: z.enum(INCUS_PLAN_ACTIONS),
      }),
    )
    .max(4096),
  payloads: z
    .array(
      z.strictObject({
        instance: name,
        path: z.string().regex(/^\/dev\/shm\/[A-Za-z0-9._-]{1,128}$/),
      }),
    )
    .max(256),
  withdrawn: z
    .array(
      z.strictObject({
        instance: name,
        marker: z.string().regex(/^\/[A-Za-z0-9._/-]{1,255}$/),
      }),
    )
    .max(256),
  restorePending: restorePendingSchema.nullable(),
});
export type IncusJournal = z.infer<typeof journalSchema>;

function journalFile(stateRoot: string): string {
  return join(incusStateDirectory(stateRoot), JOURNAL_FILE);
}

function emptyJournal(stack: string, now: Date): IncusJournal {
  return {
    schemaVersion: 1,
    stack,
    phase: 'ready',
    planSha256: null,
    updatedAt: now.toISOString(),
    steps: [],
    payloads: [],
    withdrawn: [],
    restorePending: null,
  };
}

function custodyRefusal(file: string) {
  return preconditionError(
    `${file} must be a regular file of this user with mode 0600.`,
    `chmod 600 ${file}`,
  );
}

function parseJournal(file: string, raw: unknown): IncusJournal {
  const parsed = journalSchema.safeParse(raw);
  if (!parsed.success)
    throw preconditionError(
      `${file} is not an Incus runtime journal this CLI reads.`,
      'Restore it from a backup, or move it aside once no restore is pending.',
    );
  return parsed.data;
}

/** The journal, or null where none was written yet. */
export async function readJournal(
  stateRoot: string,
): Promise<IncusJournal | null> {
  const file = journalFile(stateRoot);
  let info;
  try {
    info = await lstat(file);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return null;
    throw error;
  }
  const uid = process.getuid?.();
  if (
    !info.isFile() ||
    (info.mode & 0o077) !== 0 ||
    uid === undefined ||
    info.uid !== uid
  )
    throw custodyRefusal(file);
  const raw = await readOptionalJson(file);
  return raw === undefined ? null : parseJournal(file, raw);
}

async function writeJournal(
  stateRoot: string,
  journal: IncusJournal,
): Promise<void> {
  await mkdir(incusStateDirectory(stateRoot), {
    recursive: true,
    mode: 0o700,
  });
  await writePrivateJson(journalFile(stateRoot), journalSchema.parse(journal));
}

/** The update of each journal file this process runs last: updates queue
 * behind it, so parallel execs (their stdin files) and the applier never
 * write over each other's change. */
const journalUpdates = new Map<string, Promise<unknown>>();

/**
 * Read, change and write the journal of `stack`. A journal of another stack
 * in the same state directory is refused, never overwritten. Updates in one
 * process run one at a time.
 */
export function updateJournal(
  stateRoot: string,
  stack: string,
  change: (journal: IncusJournal) => void,
  now: () => Date = () => new Date(),
): Promise<IncusJournal> {
  const file = journalFile(stateRoot);
  // The previous update's failure is its own caller's; this one runs anyway.
  const run = () => applyJournalUpdate(stateRoot, stack, change, now);
  const update = (journalUpdates.get(file) ?? Promise.resolve()).then(run, run);
  journalUpdates.set(file, update);
  const settle = () => {
    if (journalUpdates.get(file) === update) journalUpdates.delete(file);
  };
  update.then(settle, settle);
  return update;
}

async function applyJournalUpdate(
  stateRoot: string,
  stack: string,
  change: (journal: IncusJournal) => void,
  now: () => Date,
): Promise<IncusJournal> {
  const journal = (await readJournal(stateRoot)) ?? emptyJournal(stack, now());
  if (journal.stack !== stack)
    throw preconditionError(
      `${journalFile(stateRoot)} records the stack ${journal.stack}, not ${stack}.`,
    );
  const next = structuredClone(journal);
  change(next);
  next.updatedAt = now().toISOString();
  await writeJournal(stateRoot, next);
  return next;
}

/** The verbs a pending restore stops (design D-29, R3-22). */
export type RestoreGuardedVerb =
  | 'converge'
  | 'start'
  | 'deploy'
  | 'rollback'
  | 'services'
  | 'migrate';

const VERB_WORDS: Record<RestoreGuardedVerb, string> = {
  converge: 'Converging the stack',
  start: 'tale start',
  deploy: 'tale deploy',
  rollback: 'tale rollback',
  services: 'tale deploy --services',
  migrate: 'tale migrate',
};

/** The sentence `status` prints for a pending restore, or null. */
export function restorePendingNotice(
  journal: IncusJournal | null,
): string | null {
  const pending = journal?.restorePending;
  if (!pending) return null;
  const progress = pending.volumes
    .map((volume) => `${volume} ${pending.steps[volume] ?? 'pending'}`)
    .join(', ');
  return `A restore of snapshot ${pending.id} is not finished (${progress}).`;
}

/** Refuse `verb` while a restore is pending: a missing volume then means the
 * restore has not made it yet, and anything that made it again would make it
 * empty. */
export function assertNoRestorePending(
  journal: IncusJournal | null,
  verb: RestoreGuardedVerb,
): void {
  const notice = restorePendingNotice(journal);
  if (notice === null) return;
  throw preconditionError(`${notice} ${VERB_WORDS[verb]} waits until it is.`, [
    'tale restore --resume   (finish the restore)',
    'tale restore --abort    (put the volumes back as they were)',
  ]);
}

/** Record a pending restore (`tale restore`, under the deploy lock). */
export async function setRestorePending(
  stateRoot: string,
  stack: string,
  pending: RestorePending,
  now?: () => Date,
): Promise<IncusJournal> {
  return updateJournal(
    stateRoot,
    stack,
    (journal) => {
      journal.restorePending = restorePendingSchema.parse(pending);
    },
    now,
  );
}

/** Clear a pending restore: only `tale restore --resume` or `--abort`, once
 * every volume is back. */
export async function clearRestorePending(
  stateRoot: string,
  stack: string,
  now?: () => Date,
): Promise<IncusJournal> {
  return updateJournal(
    stateRoot,
    stack,
    (journal) => {
      journal.restorePending = null;
    },
    now,
  );
}

/** Record an exec payload file before it is pushed (R3-06). */
export async function recordPayload(
  stateRoot: string,
  stack: string,
  payload: IncusJournal['payloads'][number],
): Promise<IncusJournal> {
  return updateJournal(stateRoot, stack, (journal) => {
    if (
      !journal.payloads.some(
        (entry) =>
          entry.instance === payload.instance && entry.path === payload.path,
      )
    )
      journal.payloads.push(payload);
  });
}

/** Forget a payload file once it is gone. */
export async function forgetPayload(
  stateRoot: string,
  stack: string,
  payload: IncusJournal['payloads'][number],
): Promise<IncusJournal> {
  return updateJournal(stateRoot, stack, (journal) => {
    journal.payloads = journal.payloads.filter(
      (entry) =>
        entry.instance !== payload.instance || entry.path !== payload.path,
    );
  });
}

/**
 * Mark the journal `interrupted`, synchronously: a signal handler cannot
 * await. A journal that cannot be read is left as it is (with a warning); the
 * next run plans from the node anyway.
 */
export function markInterruptedSync(
  stateRoot: string,
  now: Date = new Date(),
): void {
  const file = journalFile(stateRoot);
  try {
    const info = lstatSync(file);
    const uid = process.getuid?.();
    if (
      !info.isFile() ||
      (info.mode & 0o077) !== 0 ||
      uid === undefined ||
      info.uid !== uid
    )
      throw custodyRefusal(file);
    const handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let text: string;
    try {
      text = readFileSync(handle, 'utf8');
    } finally {
      closeSync(handle);
    }
    const journal = parseJournal(file, JSON.parse(text));
    if (journal.phase !== 'pending') return;
    journal.phase = 'interrupted';
    journal.updatedAt = now.toISOString();
    const temporary = `${file}.tmp.${randomUUID()}`;
    const out = openSync(temporary, 'wx', 0o600);
    try {
      writeSync(out, `${JSON.stringify(journal, null, 2)}\n`);
      fsyncSync(out);
    } finally {
      closeSync(out);
    }
    renameSync(temporary, file);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return;
    console.warn(
      `Could not record the interrupt in ${file}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * On SIGINT, record `interrupted` and exit 130 (design D-12). Returns the
 * function that removes the handler again.
 */
export function installInterruptJournal(
  stateRoot: string,
  exit: (code: number) => void = (code) => process.exit(code),
): () => void {
  const handler = () => {
    markInterruptedSync(stateRoot);
    exit(130);
  };
  process.once('SIGINT', handler);
  return () => {
    process.removeListener('SIGINT', handler);
  };
}
