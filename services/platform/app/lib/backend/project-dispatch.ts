/**
 * A project's dispatch over the 0.5 backend
 * (`/api/app/tasks/dispatch/by-project/:projectId`): what it does, the
 * document its editor changes, a pass asked for now and a gate held or
 * opened. Its own module rather than rows in `./tasks`: the adapter rows
 * load with every page, and only the project's Dispatch page reads these.
 *
 * Every answer is parsed at this boundary with the one zod source of its
 * shape (`@tale/shared/schemas/project-dispatch`); an answer this build does
 * not read is a failed read, never a cast. A refusal reaches the caller as
 * the `AppError` every adapted call throws (`runAdapted`), so its code and
 * its `issues` are where every surface reads them.
 *
 * The reads are keyed under the `task` hint entity: a run that starts or
 * ends, a task that moves and a project write (another session's save) all
 * refresh them. A pass that starts nothing and a report on a gate emit no
 * hint, so the readback also polls while it is shown.
 */

import { managedProjectDispatchSchema } from '@tale/shared/schemas/managed-configuration';
import {
  dispatchGateReportResultSchema,
  type ProjectDispatch,
  type ProjectDispatchStatus,
  projectDispatchStatusSchema,
} from '@tale/shared/schemas/project-dispatch';
import { queryOptions } from '@tanstack/react-query';
import { z, type ZodType } from 'zod';

import { retryAdaptedRead, runAdapted } from './adapters';
import { backendFetch } from './api-client';
import { backendKey, type BackendQueryKey } from './query-keys';

/** How often the readback is read again while it is shown: passes and gate
 * reports change it without a hint. */
const DISPATCH_STATUS_POLL_MS = 30_000;

/** The key every read of one project's dispatch starts with — what a write
 * of it invalidates. */
export function projectDispatchKey(
  organizationId: string,
  projectId: string,
): BackendQueryKey {
  return backendKey(organizationId, 'task', 'dispatch', projectId);
}

function projectDispatchConfigurationKey(
  organizationId: string,
  projectId: string,
): BackendQueryKey {
  return [...projectDispatchKey(organizationId, projectId), 'configuration'];
}

function dispatchPath(projectId: string): string {
  return `/tasks/dispatch/by-project/${encodeURIComponent(projectId)}`;
}

/** An answer read with its schema; one in a shape this build does not read
 * fails the call, with what did not parse in the console. */
function parseAnswer<T>(schema: ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  console.warn(
    `[dispatch] the ${what} answered in a shape this app does not read`,
    parsed.error.issues,
  );
  throw new Error(`The ${what} answered in a shape this app does not read.`);
}

/** What the project's dispatch does: its pool, standing roles, gates,
 * model holds, agent workers and recent passes. */
export function projectDispatchStatusQuery(
  organizationId: string,
  projectId: string,
) {
  return queryOptions<ProjectDispatchStatus>({
    queryKey: projectDispatchKey(organizationId, projectId),
    queryFn: async ({ signal }) =>
      parseAnswer(
        projectDispatchStatusSchema,
        await runAdapted(() =>
          backendFetch<unknown>(dispatchPath(projectId), {
            orgId: organizationId,
            signal,
          }),
        ),
        'dispatch readback',
      ),
    retry: retryAdaptedRead,
    // Fresh for as long as the poll takes to come round: a tab opened again
    // after that reads at once instead of showing an old pass list.
    staleTime: DISPATCH_STATUS_POLL_MS,
    refetchInterval: DISPATCH_STATUS_POLL_MS,
  });
}

const configurationAnswerSchema = z.object({
  config: managedProjectDispatchSchema.nullable(),
  hash: z.string().nullable(),
});

/** The dispatch document as managed configuration reads it, and the hash a
 * save names as the version it changes. */
export interface ProjectDispatchConfiguration {
  /** Null while the project has no dispatch. */
  dispatch: ProjectDispatch | null;
  hash: string | null;
}

/** The document the editor starts from. A stored dispatch this version
 * cannot read is refused (`CONFIG_UNREADABLE`), never read as none. */
export function projectDispatchConfigurationQuery(
  organizationId: string,
  projectId: string,
) {
  return queryOptions<ProjectDispatchConfiguration>({
    queryKey: projectDispatchConfigurationKey(organizationId, projectId),
    queryFn: async ({ signal }) => {
      const answer = parseAnswer(
        configurationAnswerSchema,
        await runAdapted(() =>
          backendFetch<unknown>(`${dispatchPath(projectId)}/configuration`, {
            orgId: organizationId,
            signal,
          }),
        ),
        'dispatch configuration',
      );
      if (answer.config === null) return { dispatch: null, hash: answer.hash };
      const { projectId: _projectId, ...dispatch } = answer.config;
      return { dispatch, hash: answer.hash };
    },
    retry: retryAdaptedRead,
    // Every opening of the editor reads the stored version again, whatever
    // the app's stale window: a save names the version it started from, and
    // one read minutes ago would be refused, or never read at all.
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });
}

const saveAnswerSchema = z.object({
  changed: z.boolean(),
  hash: z.string(),
});

/**
 * Save the project's dispatch over the version the editor started from
 * (`expectedHash`, null when there was none): a dispatch another session
 * saved meanwhile is refused (`CONFIG_VERSION_CONFLICT`), never overwritten.
 * Answers whether anything changed and the hash of what is stored now.
 */
export async function saveProjectDispatch(
  organizationId: string,
  projectId: string,
  args: { dispatch: ProjectDispatch; expectedHash: string | null },
): Promise<{ changed: boolean; hash: string }> {
  return parseAnswer(
    saveAnswerSchema,
    await runAdapted(() =>
      backendFetch<unknown>(`${dispatchPath(projectId)}/configuration`, {
        orgId: organizationId,
        method: 'POST',
        body: {
          config: { ...args.dispatch, projectId },
          expectedHash: args.expectedHash,
        },
      }),
    ),
    'dispatch save',
  );
}

/** Ask for a pass of the project's dispatch now. */
export async function requestDispatchPass(
  organizationId: string,
  projectId: string,
): Promise<void> {
  await runAdapted(() =>
    backendFetch<unknown>(`${dispatchPath(projectId)}/pass`, {
      orgId: organizationId,
      method: 'POST',
      body: {},
    }),
  );
}

/** Hold or open one of the dispatch's gates; answers the state it left the
 * gate in, and whether that changed. */
export async function setDispatchGate(
  organizationId: string,
  projectId: string,
  args: { key: string; state: 'hold' | 'open' },
): Promise<{ held: boolean; changed: boolean }> {
  return parseAnswer(
    dispatchGateReportResultSchema,
    await runAdapted(() =>
      backendFetch<unknown>(
        `${dispatchPath(projectId)}/gates/${encodeURIComponent(args.key)}`,
        {
          orgId: organizationId,
          method: 'POST',
          body: { state: args.state },
        },
      ),
    ),
    'gate report',
  );
}
