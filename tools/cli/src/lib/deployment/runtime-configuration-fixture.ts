import { expect } from 'bun:test';

import type { ExecResult } from '../docker/exec';
import type { RuntimeDependencies } from './runtime-model';
import type { RuntimeDockerFixture } from './runtime-test-helper';

/** Only the Docker transport is replaced. Real bundle, lock, private state,
 * runtime custody and activation implementation execute in these tests. */
export class ConfigurationDockerFixture {
  text = '{"version":1,"sandboxRuntime":{"tier":"runc"}}';
  file: 'deployment.yml' | 'deployment.json' | null = 'deployment.yml';
  draining = false;
  sessions: string[] = [];
  restartFailure: 'before' | 'after' | undefined;
  restarted = 0;
  restartChangesBoot = true;
  healthFailure = false;
  onRestart: (() => void) | undefined;
  onRead: (() => void) | undefined;
  statusOverride: unknown;
  constructor(readonly docker: RuntimeDockerFixture) {}
  sandbox() {
    const value = this.docker.containers.find(
      (container) =>
        (container.Config as { Labels: Record<string, string> }).Labels[
          'com.docker.compose.service'
        ] === 'sandbox',
    );
    if (!value) throw Error('Fixture spawner absent');
    return value;
  }
  dependencies(): RuntimeDependencies {
    const base = this.docker.dependencies();
    const ok = (value: unknown = ''): ExecResult => ({
      success: true,
      exitCode: 0,
      stderr: '',
      stdout: typeof value === 'string' ? value : JSON.stringify(value),
    });
    return {
      ...base,
      exec: async (command, args, options) => {
        const handled =
          args[0] === 'restart' ||
          (args[0] === 'exec' &&
            (args.includes('-e') ||
              args.includes('/app/src/control-cli.ts') ||
              args.includes('http://127.0.0.1:8003/health')));
        if (!handled) return this.docker.execute(command, args, options);
        this.docker.calls.push({ args, options });
        expect(command).toBe('docker');
        expect(options?.silent).toBe(true);
        expect(options?.env).not.toHaveProperty('TALE_TEST_UNUSED_SECRET');
        expect(args[0] === 'restart' ? args.at(-1) : args[1]).toBe(
          this.sandbox().Id as string,
        );
        if (args[0] === 'restart') {
          expect(args.slice(0, 3)).toEqual(['restart', '--time', '30']);
          if (this.restartFailure === 'before')
            throw Error('synthetic restart failed before acceptance');
          this.restarted++;
          if (this.restartChangesBoot)
            (this.sandbox().State as Record<string, unknown>).StartedAt =
              `2026-09-10T00:01:${String(this.restarted).padStart(2, '0')}.000000001Z`;
          this.draining = false;
          this.onRestart?.();
          if (this.restartFailure === 'after')
            throw Error('synthetic accepted restart response loss');
          return ok();
        }
        if (args.includes('-e')) {
          expect(args.slice(2, 6)).toEqual(['timeout', '15', 'bun', '-e']);
          this.onRead?.();
          return ok({
            file: this.file,
            data:
              this.file === null
                ? null
                : Buffer.from(this.text).toString('base64'),
          });
        }
        if (args.includes('/app/src/control-cli.ts')) {
          expect(args.slice(2, 6)).toEqual([
            'timeout',
            '15',
            'bun',
            '/app/src/control-cli.ts',
          ]);
          if (args.at(-1) === 'drain') {
            this.draining = true;
            return ok({ draining: true });
          }
          expect(args.at(-1)).toBe('drain-status');
          return ok(
            this.statusOverride ?? {
              draining: this.draining,
              sessions: this.sessions.length,
              sessionIds: this.sessions,
            },
          );
        }
        return this.healthFailure
          ? { ...ok(), success: false, exitCode: 1 }
          : ok();
      },
    };
  }
}
