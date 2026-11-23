/**
 * The reads the dashboard fires on its way to the first screen, in the
 * order the app's routes and the providers mounted there issue them
 * (`app/routes/dashboard*.tsx`): what a browser that opens the app asks the
 * API before its person does anything.
 *
 * - `/dashboard`: the account gates and the current user, then the
 *   organization picker's memberships and the last-active pointer;
 * - `/dashboard/$id`: the member context and the caller's teams;
 * - Home, when it mounts: the thread list, the projects, the person's open
 *   and in-review tasks, the preferences, the two unread counts, the inbox
 *   gate's automation listing and API sources, and the model catalog.
 *
 * A virtual user (`scenario/user.ts`) boots its tab with them, and the
 * memory budget's people (`budget/workload.ts`) open the app with them.
 */

import { type ThreadRow, listThreads } from './chat.ts';
import type { ApiClient, ApiResult } from './client.ts';
import {
  type ComposerModel,
  automationsListing,
  composerModels,
  conversationApiSources,
  currentUser,
  lastActiveOrganization,
  memberContext,
  myOrganizations,
  myTeams,
  passwordExpiry,
  twoFactorStatus,
  userPreferences,
} from './shell.ts';
import { OPEN_TASK_STATUSES, listTasksAcrossProjects } from './tasks.ts';
import { listProjects, myUnreadCount, orgUnreadCount } from './workspace.ts';

/** `/dashboard`'s loader and its index: the gates, then the picker. */
export async function dashboardBootReads(
  api: ApiClient,
): Promise<{ lastActive: ApiResult<string | null> }> {
  await Promise.all([
    twoFactorStatus(api),
    passwordExpiry(api),
    currentUser(api),
  ]);
  const [, lastActive] = await Promise.all([
    myOrganizations(api),
    lastActiveOrganization(api),
  ]);
  return { lastActive };
}

/** `/dashboard/$id`'s loader: the member context and the caller's teams. */
export async function organizationBootReads(
  api: ApiClient,
  orgId: string,
): Promise<{
  context: Awaited<ReturnType<typeof memberContext>>;
}> {
  const [context] = await Promise.all([
    memberContext(api, orgId),
    myTeams(api, orgId),
  ]);
  return { context };
}

/** Home's task reads: what is assigned to the person and still open, and
 * what waits for their review. Nothing without a user id. */
export async function homeTaskReads(
  api: ApiClient,
  orgId: string,
  userId: string | undefined,
): Promise<void> {
  if (userId === undefined) return;
  await Promise.all([
    listTasksAcrossProjects(api, orgId, {
      statuses: OPEN_TASK_STATUSES,
      assigneeId: userId,
    }),
    listTasksAcrossProjects(api, orgId, {
      status: 'in_review',
      reviewerId: userId,
    }),
  ]);
}

/** Every read Home fires when it mounts. */
export async function homeBootReads(
  api: ApiClient,
  orgId: string,
  userId: string | undefined,
): Promise<{
  threads: ApiResult<ThreadRow[]>;
  models: ApiResult<ComposerModel[]>;
}> {
  const [threads, , , , , , , models] = await Promise.all([
    listThreads(api, orgId),
    listProjects(api, orgId),
    homeTaskReads(api, orgId, userId),
    userPreferences(api, orgId),
    orgUnreadCount(api, orgId),
    myUnreadCount(api, orgId),
    automationsListing(api, orgId),
    composerModels(api, orgId),
    conversationApiSources(api, orgId),
  ]);
  return { threads, models };
}
