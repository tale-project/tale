import type { Sql, TransactionSql } from 'postgres';

import { isAutomationSubject } from '../../../lib/shared/constants/usage.ts';
import { loadBudgetSubject, type OrgBudgetSubject } from './budget-gate.ts';

/** Whose spend a run's work is (`SessionOpAttribution`'s budget axes). */
export interface BudgetAttribution {
  userId: string;
  apiKeyId?: string;
  projectIds?: readonly string[];
}

/**
 * The subject the caps measure for work a run is attributed to: its person
 * as they are now, through {@link loadBudgetSubject} — or, for nobody's
 * spend (a run a trigger started, booked under `__automation__`, or work
 * with no run to attribute), an impersonal subject that only the
 * organization's caps bind, with the key's and the projects' when the work
 * names them. One reading for an agent turn's allowance, its images, and an
 * automation's `llm` steps.
 */
export async function loadAttributedBudgetSubject(
  sql: Sql | TransactionSql,
  organizationId: string,
  attribution: BudgetAttribution | null,
): Promise<OrgBudgetSubject> {
  const userId = attribution?.userId ?? '';
  const apiKey =
    attribution?.apiKeyId !== undefined
      ? { apiKeyId: attribution.apiKeyId }
      : {};
  const projects =
    attribution?.projectIds !== undefined
      ? { projectIds: attribution.projectIds }
      : {};
  return userId === '' || isAutomationSubject(userId)
    ? {
        organizationId,
        userId,
        userTeamIds: [],
        impersonal: true,
        ...apiKey,
        ...projects,
      }
    : loadBudgetSubject(sql, {
        organizationId,
        userId,
        ...apiKey,
        ...projects,
      });
}
