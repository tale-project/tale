/**
 * What an automation run meets when an administrator's Destroy takes the
 * sandbox workspace its steps work in. Kept apart from `session_constants`,
 * which the released 0.5 automation flow reuses as it shipped (the
 * legacy-flow provenance guard pins it byte for byte).
 */

/** What an automation step refused for a pending Destroy says: the run's
 * files go with the workspace, so the step cannot wait for it. */
export const WORKFLOW_DESTROY_PENDING_MESSAGE =
  "An administrator is deleting this run's sandbox workspace, and with it the files its earlier steps left there. The run cannot go on without them: start the automation again.";

/** The `code` of the refusal an automation run meets when its workspace
 * was deleted after the run worked in it (`SandboxWorkspaceDestroyedError`,
 * `isWorkspaceDestroyedRefusal`). No quota refusal: no room frees for it. */
export const SANDBOX_WORKSPACE_DESTROYED_CODE = 'SANDBOX_WORKSPACE_DESTROYED';

/** What that refusal says. */
export const SANDBOX_WORKSPACE_DESTROYED_MESSAGE =
  "This run's sandbox workspace was deleted, and with it the files its earlier steps left there. The run cannot go on without them: start the automation again.";
