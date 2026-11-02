/**
 * A list of proxies taken in turn — round robin, counted per process. A proxy
 * that cannot be reached, or refuses its credentials, is passed over for a
 * minute, so a dead entry costs one failed attempt a minute instead of every
 * Nth request. When every proxy is passed over the rotation goes on through
 * all of them: a request never leaves unproxied because the proxies are
 * failing.
 *
 * Each list keeps its own turn and its own memory of the proxies it passes
 * over: the deployment's outbound proxies (`./outbound-proxy`) and video
 * ingestion's own (`./video-ingest-proxies`).
 */

/** What a rotation needs of a proxy. */
export interface RotatedProxy {
  /** The proxy as clients are given it, credentials included. Never log it. */
  readonly url: string;
  /** `scheme://host:port` — what a log line or an error names. */
  readonly label: string;
}

/** How long a proxy that failed is passed over. */
export const PROXY_SET_ASIDE_MS = 60_000;

/** What a caller may ask of {@link ProxyRotation.next} beyond the turn. */
export interface ProxyPick<P extends RotatedProxy> {
  /** The one to take when it is still listed, not passed over and not
   * skipped; the rotation does not move for it. */
  prefer?: P | null;
  /** Proxies (by URL) never to take, every entry that lists them. */
  skip?: ReadonlySet<string>;
}

export class ProxyRotation<P extends RotatedProxy> {
  private parsed: { raw: string; proxies: readonly P[] } | null = null;
  private cursor = 0;
  /** Until when each proxy (by its URL) is passed over. */
  private readonly asideUntil = new Map<string, number>();

  /**
   * @param envName The variable that lists the proxies.
   * @param parse Its value, parsed; throws on a malformed entry, which the
   *   backend's boot check refuses first.
   * @param logTag What the line that passes over a proxy starts with.
   */
  constructor(
    private readonly envName: string,
    private readonly parse: (raw: string) => readonly P[],
    private readonly logTag: string,
  ) {}

  /** The configured proxies, parsed once per value; empty when none are set. */
  proxies(env: NodeJS.ProcessEnv = process.env): readonly P[] {
    const raw = env[this.envName] ?? '';
    if (this.parsed?.raw !== raw) {
      this.parsed = { raw, proxies: this.parse(raw) };
    }
    return this.parsed.proxies;
  }

  /** The proxy the next request goes out through, or null when none is
   * configured or every one is skipped. Passes over a proxy that is set
   * aside, unless every proxy it may take is. */
  next(
    env: NodeJS.ProcessEnv = process.env,
    now: number = Date.now(),
    { prefer = null, skip }: ProxyPick<P> = {},
  ): P | null {
    const proxies = this.proxies(env);
    if (proxies.length === 0) return null;
    const usable = (proxy: P): boolean => !skip?.has(proxy.url);
    if (
      prefer !== null &&
      usable(prefer) &&
      (this.asideUntil.get(prefer.url) ?? 0) <= now
    ) {
      const listed = proxies.find((proxy) => proxy.url === prefer.url);
      if (listed !== undefined) return listed;
    }
    const start = this.cursor % proxies.length;
    let passedOver: number | null = null;
    for (let offset = 0; offset < proxies.length; offset += 1) {
      const index = (start + offset) % proxies.length;
      const proxy = proxies[index];
      if (proxy === undefined || !usable(proxy)) continue;
      if ((this.asideUntil.get(proxy.url) ?? 0) <= now) {
        this.cursor = (index + 1) % proxies.length;
        return proxy;
      }
      passedOver ??= index;
    }
    if (passedOver === null) return null;
    // Every proxy left is passed over: the rotation goes on through all of them.
    this.cursor = (passedOver + 1) % proxies.length;
    return proxies[passedOver] ?? null;
  }

  /** Where `proxy` stands in the list, counted from 1 as the boot check
   * counts entries (0 when it is not listed): what tells apart entries that
   * share a host and port, as a provider's per-address user names on one
   * gateway do. */
  entry(proxy: P, env: NodeJS.ProcessEnv = process.env): number {
    return (
      this.proxies(env).findIndex((listed) => listed.url === proxy.url) + 1
    );
  }

  /** Pass over `proxy` for {@link PROXY_SET_ASIDE_MS}, after it could not
   * carry a request. `why` is logged with the proxy's label, never its
   * credentials. */
  setAside(proxy: P, why: string, now: number = Date.now()): void {
    const passedOver = (this.asideUntil.get(proxy.url) ?? 0) > now;
    this.asideUntil.set(proxy.url, now + PROXY_SET_ASIDE_MS);
    if (!passedOver) {
      console.warn(
        `[${this.logTag}] ${proxy.label} failed (${why}); passing over it for ${PROXY_SET_ASIDE_MS / 1000} s`,
      );
    }
  }

  /** Test seam: forget the rotation's position and every set-aside proxy. */
  reset(): void {
    this.parsed = null;
    this.cursor = 0;
    this.asideUntil.clear();
  }
}
