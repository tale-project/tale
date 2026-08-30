import type { MutationCtx, QueryCtx } from '../lib/ctx';
/** Rows scanned per membership check — a member holds a handful of
 * competences, not thousands; the cap bounds a pathological org. */
import type { Doc } from '../lib/rows';
const COMPETENCE_SCAN_CAP = 200;

/** Whether the record vouches for its holder RIGHT NOW. */
export function isCompetenceRecordActive(
  record: Pick<Doc<'competenceRecords'>, 'expiresAt' | 'revokedAt'>,
  now: number,
): boolean {
  if (record.revokedAt !== undefined) return false;
  if (record.expiresAt !== undefined && record.expiresAt <= now) return false;
  return true;
}

/**
 * Whether `userId` holds EVERY competence in `required` through unexpired,
 * unrevoked records. Returns the vouching record ids so the caller can stamp
 * WHICH grants justified the decision (the review check outcome), and the
 * missing slugs so a refusal can name what is lacking. An empty `required`
 * trivially holds.
 */
export async function holdsAllCompetences(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  userId: string,
  required: readonly string[],
): Promise<{ holdsAll: boolean; heldRecordIds: string[]; missing: string[] }> {
  if (required.length === 0) {
    return { holdsAll: true, heldRecordIds: [], missing: [] };
  }
  const now = Date.now();
  const rows = await ctx.db
    .query('competenceRecords')
    .withIndex('by_org_user', (q) =>
      q.eq('organizationId', organizationId).eq('userId', userId),
    )
    .take(COMPETENCE_SCAN_CAP);
  const activeBySlug = new Map<string, Doc<'competenceRecords'>>();
  for (const row of rows) {
    if (isCompetenceRecordActive(row, now)) {
      activeBySlug.set(row.competence, row);
    }
  }
  const heldRecordIds: string[] = [];
  const missing: string[] = [];
  for (const slug of new Set(required)) {
    const record = activeBySlug.get(slug);
    if (record === undefined) missing.push(slug);
    else heldRecordIds.push(String(record._id));
  }
  return { holdsAll: missing.length === 0, heldRecordIds, missing };
}
