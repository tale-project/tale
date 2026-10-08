import type { Sql } from 'postgres';

import {
  AUTOMATION_SUBJECT_ID,
  TRANSCRIPTION_SLUG,
} from '../../../lib/shared/constants/usage.ts';
import { estimateTranscriptionCostCents } from '../../core/governance/cost_estimation.ts';
import { readThreadProjectId } from '../chat/threads.ts';
import {
  type DirectCallLease,
  type DirectCallSubject,
  openDirectCall,
  releaseDirectCall,
  settleDirectCall,
} from '../governance/direct-calls.ts';

/**
 * A transcription is a direct call (`governance/direct-calls.ts`) billed by
 * the minute of audio: before the provider hears anything, the whole
 * recording's length at the catalog's per-minute price is held against the
 * limits that bind whoever the transcription is for, and refused when a
 * limit has too little room for it; after it, the minutes the provider
 * transcribed are booked in the hold's place under `__transcription__` —
 * the minutes of a failed attempt's finished chunks too, as the provider
 * billed them.
 *
 * An uploaded recording is its uploader's spend (a retry continues their
 * upload, whoever presses it), and the project's of the chat it was added
 * to; a dictation is the dictating member's.
 */

/** The longest a transcription may hold its worst case: the job's own
 * lease (35 minutes) with room to spare. */
const TRANSCRIPTION_CALL_MAX_MS = 40 * 60 * 1000;

/** The model a transcription runs on, and its price. */
export interface TranscriptionModelFacts {
  organizationId: string;
  provider: string;
  model: string;
  centsPerAudioMinute?: number;
}

export type TranscriptionAdmission =
  | { allowed: true; lease: DirectCallLease }
  | { allowed: false; reason: string };

/** Hold a transcription's whole length under `subject`. */
export async function openTranscriptionCall(
  sql: Sql,
  args: TranscriptionModelFacts & {
    subject: DirectCallSubject;
    audioDurationSec: number;
  },
): Promise<TranscriptionAdmission> {
  const admission = await openDirectCall(sql, {
    organizationId: args.organizationId,
    lane: 'transcription',
    subject: args.subject,
    worstCase: {
      cents: estimateTranscriptionCostCents(
        args.audioDurationSec,
        args.centsPerAudioMinute,
      ),
      tokens: 0,
    },
    modelRef: `${args.provider}/${args.model}`,
    maxDurationMs: TRANSCRIPTION_CALL_MAX_MS,
  });
  return admission.allowed
    ? { allowed: true, lease: admission.lease }
    : { allowed: false, reason: admission.reason };
}

/** Whose spend an uploaded recording's transcription is: its uploader's —
 * the organization's when nobody is named — and the project's of the chat
 * it was added to. */
export async function uploadTranscriptionSubject(
  sql: Sql,
  args: { organizationId: string; storageId: string },
): Promise<DirectCallSubject> {
  const rows = await sql<
    { uploadedBy: string | null; threadId: string | null }[]
  >`
    SELECT uploaded_by AS "uploadedBy", thread_id AS "threadId"
    FROM app.file_metadata
    WHERE org_id = ${args.organizationId} AND storage_ref = ${args.storageId}
    LIMIT 1
  `;
  const row = rows[0];
  const projectId =
    row?.threadId != null
      ? await readThreadProjectId(sql, args.organizationId, row.threadId)
      : undefined;
  return {
    userId: row?.uploadedBy ?? AUTOMATION_SUBJECT_ID,
    agentSlug: TRANSCRIPTION_SLUG,
    ...(projectId !== undefined ? { projectIds: [projectId] } : {}),
  };
}

/** Book the minutes the provider transcribed in the hold's place. */
export async function settleTranscriptionCall(
  sql: Sql,
  args: TranscriptionModelFacts & {
    lease: DirectCallLease;
    audioDurationSec: number;
  },
): Promise<void> {
  await settleDirectCall(sql, args.lease, {
    provider: args.provider,
    model: args.model,
    inputTokens: 0,
    outputTokens: 0,
    costCents: estimateTranscriptionCostCents(
      args.audioDurationSec,
      args.centsPerAudioMinute,
    ),
    audioDurationSec: args.audioDurationSec,
  });
}

/** Release the hold of a transcription that transcribed nothing. */
export async function releaseTranscriptionCall(
  sql: Sql,
  args: { lease: DirectCallLease },
): Promise<void> {
  await releaseDirectCall(sql, args.lease);
}
