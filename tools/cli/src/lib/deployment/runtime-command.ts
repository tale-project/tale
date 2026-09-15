import { externalDepError } from '../../utils/fail';
import * as logger from '../../utils/logger';
import { exec, type ExecResult } from '../docker/exec';
import type { RuntimeDependencies } from './runtime-model';

const DOCKER_ENVIRONMENT = [
  'PATH',
  'HOME',
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_CERT_PATH',
  'DOCKER_TLS_VERIFY',
  'XDG_RUNTIME_DIR',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
] as const;

/** Docker may need its host socket/config, never ambient Compose interpolation. */
export function runtimeProcessEnvironment(): Record<string, string> {
  return Object.fromEntries(
    DOCKER_ENVIRONMENT.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

/** ` (detail)` from the caller's diagnosis, or nothing when it has none. */
async function failureContext(
  diagnose: (() => Promise<string | null>) | undefined,
): Promise<string> {
  if (!diagnose) return '';
  try {
    const detail = await diagnose();
    return detail ? ` (${detail})` : '';
  } catch {
    // The failure still surfaces, unexplained. The reason stays out of the
    // log for the same reason Docker's own output does.
    logger.warn('Docker state could not be read to explain the failure.');
    return '';
  }
}

export async function runtimeCommand(
  args: string[],
  dependencies: RuntimeDependencies,
  options: {
    cwd?: string;
    timeout?: number;
    allowFailure?: boolean;
    operation?: 'compose-validation' | 'compose-startup';
    /**
     * What Docker's state shows about a failure, in fixed vocabulary such as
     * `proxy: unhealthy`, appended to the summary. Never the command's own
     * output: Compose can echo the environment it loaded.
     */
    diagnose?: () => Promise<string | null>;
  } = {},
): Promise<ExecResult> {
  // Use only fixed labels: Docker arguments and failures can contain secrets.
  const operation =
    options.operation === 'compose-validation'
      ? 'managed Compose validation'
      : options.operation === 'compose-startup'
        ? 'managed Compose startup'
        : 'the managed runtime operation';
  let result: ExecResult;
  try {
    result = await (dependencies.exec ?? exec)('docker', args, {
      cwd: options.cwd,
      timeout: options.timeout ?? 60,
      silent: true,
      env: runtimeProcessEnvironment(),
    });
  } catch {
    throw externalDepError(
      `Docker could not complete ${operation}${await failureContext(options.diagnose)}.`,
    );
  }
  if (!result.success && !options.allowFailure) {
    throw externalDepError(
      `Docker refused ${operation}${await failureContext(options.diagnose)}.`,
    );
  }
  return result;
}

export function runtimeSleep(
  dependencies: RuntimeDependencies,
  milliseconds: number,
): Promise<void> {
  return (
    dependencies.sleep?.(milliseconds) ??
    new Promise((resolve) => setTimeout(resolve, milliseconds))
  );
}
