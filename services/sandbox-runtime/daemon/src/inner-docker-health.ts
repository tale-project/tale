import { request } from 'node:http';

/** Root-owned control socket; probing it never activates the Docker engine. */
export const LAZY_DOCKER_HEALTH_SOCKET = '/var/run/tale-docker-health.sock';
export const DOCKER_RECOVERY_HEADER = 'x-tale-docker-recovery-required';
/** The supervisor's engine lifecycle: `cold` until the first activation,
 * `running` while an engine is starting or up, `stopped` after it slept or
 * failed. */
export const DOCKER_ENGINE_HEADER = 'x-tale-docker-engine';
export type DockerEngineState = 'cold' | 'running' | 'stopped';

function engineState(value: unknown): DockerEngineState | undefined {
  return value === 'cold' || value === 'running' || value === 'stopped'
    ? value
    : undefined;
}

interface DockerObservation {
  ready: boolean;
  /** Present only on a validated supervisor response. */
  recoveryRequired?: boolean;
  /** Present only on a validated supervisor response that names it. */
  engine?: DockerEngineState;
}

interface DockerReading {
  ready: boolean;
  recoveryRequired: boolean;
  engine?: DockerEngineState;
  at: number;
}

const RECOVERY_FAILURES = 3;
const RECOVERY_SPAN_MS = 5_000;

/** Observe the inner engine directly. A Docker CLI can wait indefinitely and
 * read user-controlled contexts/plugins; the daemon's fixed local socket is
 * the capability runnerd actually promises. Health calls share one bounded
 * probe and a short cache, so polling cannot spawn processes or pile up I/O. */
export class InnerDockerHealth {
  private reading: DockerReading | undefined;
  private pending: Promise<DockerReading> | undefined;
  private failure: { since: number; count: number } | undefined;

  constructor(
    private readonly enabled: boolean,
    private readonly options: {
      socketPath?: string;
      timeoutMs?: number;
      cacheMs?: number;
      now?: () => number;
      /** The protected supervisor supplies per-engine confidence itself. */
      supervisor?: boolean;
    } = {},
  ) {}

  async snapshot(): Promise<{
    dockerReady?: boolean;
    dockerRecoveryRequired?: boolean;
    /** Whether the lazy engine ever ran in this container: the spawner keeps
     * an inner image store worth its full idle window only when it did. */
    docker?: { engine: DockerEngineState; used: boolean };
  }> {
    if (!this.enabled) return {};
    const reading = await this.observe();
    return {
      dockerReady: reading.ready,
      dockerRecoveryRequired: reading.recoveryRequired,
      ...(reading.engine
        ? {
            docker: {
              engine: reading.engine,
              used: reading.engine !== 'cold',
            },
          }
        : {}),
    };
  }

  async ready(): Promise<boolean> {
    return !this.enabled || (await this.observe()).ready;
  }

  private observe(): Promise<DockerReading> {
    const now = this.options.now ?? (() => performance.now());
    if (
      this.reading !== undefined &&
      // Recovery permission must be re-observed. A healthy or replacement
      // engine cannot inherit a cached destructive decision from its past.
      !this.reading.recoveryRequired &&
      now() - this.reading.at < (this.options.cacheMs ?? 1_000)
    ) {
      return Promise.resolve(this.reading);
    }
    this.pending ??= this.probe()
      .then((observation) => {
        const at = now();
        let recoveryRequired = false;
        if (observation.ready || observation.recoveryRequired !== undefined) {
          // A valid supervisor response is one authoritative engine reading,
          // not another independent failure of the control transport.
          this.failure = undefined;
          recoveryRequired =
            !observation.ready && observation.recoveryRequired === true;
        } else {
          this.failure = {
            since: this.failure?.since ?? at,
            count: Math.min(RECOVERY_FAILURES, (this.failure?.count ?? 0) + 1),
          };
          recoveryRequired =
            this.failure.count >= RECOVERY_FAILURES &&
            at - this.failure.since >= RECOVERY_SPAN_MS;
        }
        this.reading = {
          ready: observation.ready,
          recoveryRequired,
          ...(observation.engine ? { engine: observation.engine } : {}),
          at,
        };
        return this.reading;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private probe(): Promise<DockerObservation> {
    return new Promise((resolve) => {
      let finished = false;
      const done = (
        ready: boolean,
        recoveryRequired?: boolean,
        engine?: DockerEngineState,
      ) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        resolve({ ready, recoveryRequired, ...(engine ? { engine } : {}) });
      };
      const req = request(
        {
          socketPath: this.options.socketPath ?? '/var/run/docker.sock',
          path: '/_ping',
          method: 'GET',
          agent: false,
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
            if (body.length > 16) {
              done(false);
              res.destroy();
              req.destroy();
            }
          });
          res.on('end', () => {
            const ready = res.statusCode === 200 && body.trim() === 'OK';
            if (!this.options.supervisor) {
              done(ready);
              return;
            }
            const recovery = res.headers[DOCKER_RECOVERY_HEADER];
            const unavailable =
              res.statusCode === 503 && body.trim() === 'unavailable';
            if (
              (ready && recovery === 'false') ||
              (unavailable && (recovery === 'false' || recovery === 'true'))
            ) {
              done(
                ready,
                recovery === 'true',
                engineState(res.headers[DOCKER_ENGINE_HEADER]),
              );
            } else {
              // Missing, malformed or contradictory metadata is not proof of
              // an engine failure. Bound it as a control-transport failure.
              done(false);
            }
          });
          res.on('error', () => done(false));
          res.on('close', () => done(false));
        },
      );
      // An elapsed-time bound, including a server that trickles response
      // bytes forever. Socket inactivity timeouts alone do not bound that.
      const deadline = setTimeout(() => {
        done(false);
        req.destroy();
      }, this.options.timeoutMs ?? 750);
      req.on('error', () => done(false));
      req.end();
    });
  }
}
