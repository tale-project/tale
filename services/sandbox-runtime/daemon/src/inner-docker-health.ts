import { request } from 'node:http';

/** Observe the inner engine directly. A Docker CLI can wait indefinitely and
 * read user-controlled contexts/plugins; the daemon's fixed local socket is
 * the capability runnerd actually promises. Health calls share one bounded
 * probe and a short cache, so polling cannot spawn processes or pile up I/O. */
export class InnerDockerHealth {
  private reading: { ready: boolean; at: number } | undefined;
  private pending: Promise<boolean> | undefined;

  constructor(
    private readonly enabled: boolean,
    private readonly options: {
      socketPath?: string;
      timeoutMs?: number;
      cacheMs?: number;
      now?: () => number;
    } = {},
  ) {}

  async snapshot(): Promise<{ dockerReady?: boolean }> {
    return this.enabled ? { dockerReady: await this.ready() } : {};
  }

  ready(): Promise<boolean> {
    if (!this.enabled) return Promise.resolve(true);
    const now = this.options.now ?? Date.now;
    if (
      this.reading !== undefined &&
      now() - this.reading.at < (this.options.cacheMs ?? 1_000)
    ) {
      return Promise.resolve(this.reading.ready);
    }
    this.pending ??= this.probe()
      .then((ready) => {
        this.reading = { ready, at: now() };
        return ready;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private probe(): Promise<boolean> {
    return new Promise((resolve) => {
      let finished = false;
      const done = (ready: boolean) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        resolve(ready);
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
          res.on('end', () =>
            done(res.statusCode === 200 && body.trim() === 'OK'),
          );
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
