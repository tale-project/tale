import { EMBEDDED_CLI_BUILD } from '../../generated/embedded-files';
import { preconditionError } from '../../utils/fail';
import { gitSha } from '../config/releases/model';

declare const TALE_COMPILED: boolean | undefined;

export function deploymentBuild(): { revision: string; binary: string } {
  if (typeof TALE_COMPILED === 'undefined' || !TALE_COMPILED)
    throw preconditionError(
      'Prepare deployments with the compiled Tale CLI executable.',
    );
  if (
    !EMBEDDED_CLI_BUILD.clean ||
    !gitSha.safeParse(EMBEDDED_CLI_BUILD.revision).success
  )
    throw preconditionError(
      'Deployment preparation requires a CLI built from a clean, committed Tale checkout.',
    );
  return {
    revision: gitSha.parse(EMBEDDED_CLI_BUILD.revision),
    binary: process.execPath,
  };
}
