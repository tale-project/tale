/**
 * How this release's agent lanes read a refused sandbox start: the readers
 * of `capacity_refusal`, narrowed to a refusal's code, and the refusal an
 * automation run meets once its workspace was deleted under it.
 *
 * `capacity_refusal` stays as the released 0.5 automation flow reuses it
 * (the legacy-flow provenance guard pins it byte for byte), and so that
 * flow still reads a `QUOTA_EXCEEDED` named in a plain Error's message as a
 * refusal. Here only a code says so: a staging error that quotes a file's
 * name, say, is no refusal (the ctx shim passes a handler's error through
 * as it is, so a refusal keeps its code).
 */

import { AppError } from '../../../../lib/shared/errors/app-error';
import { SANDBOX_WORKSPACE_DESTROYED_CODE } from '../../sandbox/run_workspace_destroy';
import {
  isDestroyPendingRefusal as releasedIsDestroyPendingRefusal,
  sandboxCapacityRefusal as releasedCapacityRefusal,
  type CapacityRefusal,
} from './capacity_refusal';

/** The capacity refusal `err` is, or null when it is anything else — a
 * refusal for a pending Destroy or a deleted workspace, and an error whose
 * message merely names `QUOTA_EXCEEDED`, included. */
export function sandboxCapacityRefusal(err: unknown): CapacityRefusal | null {
  const refusal = releasedCapacityRefusal(err);
  return refusal?.scope === 'organization' && !carriesQuotaCode(err)
    ? null
    : refusal;
}

/** Whether `err` refused a start because an administrator's Destroy of its
 * session is queued, retrying or running (the sessions domain's
 * `SandboxDestroyPendingError`), read from its code and reason. */
export function isDestroyPendingRefusal(err: unknown): boolean {
  return carriesQuotaCode(err) && releasedIsDestroyPendingRefusal(err);
}

/** Whether `err` refused an automation run's start because the run's
 * workspace was deleted after the run worked in it (the sessions domain's
 * `SandboxWorkspaceDestroyedError`). The shims pass it through as it is, so
 * its own `code` says so. */
export function isWorkspaceDestroyedRefusal(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    err.code === SANDBOX_WORKSPACE_DESTROYED_CODE
  );
}

/** Whether `capacity_refusal` reads a quota refusal in `err` from a code:
 * the AppError a shim carries it on (`data.code`, `data.reason`) or the
 * sessions domain's `SandboxQuotaError` (its own `code` and `reason`), not
 * a plain Error's message. */
function carriesQuotaCode(err: unknown): boolean {
  return (
    err instanceof AppError ||
    (err instanceof Error && 'code' in err && err.code === 'QUOTA_EXCEEDED')
  );
}
