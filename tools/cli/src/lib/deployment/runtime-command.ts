import { externalDepError } from '../../utils/fail';
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

export async function runtimeCommand(
  args: string[],
  dependencies: RuntimeDependencies,
  options: {
    cwd?: string;
    timeout?: number;
    allowFailure?: boolean;
    operation?: 'compose-validation' | 'compose-startup';
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
    throw externalDepError(`Docker could not complete ${operation}.`);
  }
  if (!result.success && !options.allowFailure) {
    throw externalDepError(`Docker refused ${operation}.`);
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
