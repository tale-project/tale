/**
 * The budget's sampler: every 250 ms it reads the `memory.stat` of every
 * container of the deployment, one after the other within the same turn of
 * the event loop, and keeps what the budget asks of those instants:
 *
 * - each container's own peak of the counted reading, its page cache at
 *   that moment, and its own peak page cache;
 * - each share's peak: the sum of its containers at one instant;
 * - the deployment's peak: the sum over every container at one instant, the
 *   instant it happened and what each container held then.
 *
 * Containers come and go while it runs: the list is read again every second
 * (`ContainerSource`), a new container is read from the next instant on, and
 * one whose cgroup disappears between two listings (it stopped) is read no
 * more. A container counts at an instant only when it was read at that
 * instant; nothing is carried over from an earlier one. A container whose
 * cgroup is one another container is read from is not read (it would count
 * the same memory twice) and is named; the longest time the list went
 * without a successful listing is kept, since a container that started then
 * went unread.
 *
 * Two colours of the app tier at one instant are a blue/green overlap, which
 * the budget keeps outside its ceiling, bounded to one extra app-tier share:
 * at such an instant the smaller colour's app tier is the overlap, reported
 * on its own and left out of the deployment's and the app tier's reading.
 *
 * The figures say how well the sampler kept time: the longest gap between
 * two instants and how many came late. A gap longer than a second means a
 * peak may have passed unseen (`judgeBudget` calls the reading inconclusive).
 */

import {
  type CgroupLocator,
  type MemoryReading,
  type ResolvedCgroup,
  readMemoryStat,
  resolveContainerCgroup,
} from './cgroup.ts';
import type {
  Colour,
  ContainerSource,
  DeploymentContainer,
  EngineFacts,
} from './docker.ts';
import {
  type CountedField,
  SAMPLE_INTERVAL_MS,
  SHARES,
  type ShareKey,
  shareOf,
} from './limits.ts';

/** One container, as the sampler saw it over the run. */
export interface ContainerFigures {
  readonly id: string;
  readonly name: string;
  readonly project: string;
  readonly service: string;
  readonly colour: Colour | null;
  /** The share its service counts toward; null for none. */
  readonly share: ShareKey | null;
  /** Its cgroup's directory, once found. */
  cgroup: string | null;
  /** How the cgroup was found. */
  via: string | null;
  /** When it was first listed (ms since the sampler opened). */
  firstSeenMs: number;
  /** When it was last read. */
  lastReadMs: number | null;
  /** When it was seen gone: unlisted, or its cgroup vanished. */
  goneMs: number | null;
  /** Why its cgroup could not be found, while it could not. */
  unresolved: string | null;
  samples: number;
  peakCounted: number;
  peakCountedAtMs: number | null;
  /** Each counted field at its peak. */
  peakFields: Record<CountedField, number> | null;
  /** Its page cache at its counted peak. */
  fileAtPeak: number;
  peakFile: number;
  peakFileAtMs: number | null;
  lastCounted: number | null;
  readErrors: number;
  firstReadError: string | null;
}

/** One container's part of an instant. */
export interface InstantPart {
  readonly name: string;
  readonly service: string;
  readonly colour: Colour | null;
  readonly counted: number;
  readonly file: number;
}

/** The deployment at one instant. */
export interface Instant {
  /** ms since the sampler opened. */
  readonly atMs: number;
  /** The budget's reading: every container, the overlap left out. */
  readonly counted: number;
  /** Every container, the overlap included. */
  readonly total: number;
  /** The second colour's app tier at a blue/green overlap; 0 without one. */
  readonly overlap: number;
  /** The page cache of every container. */
  readonly file: number;
  readonly parts: readonly InstantPart[];
}

export interface ShareFigures {
  readonly key: ShareKey;
  peakCounted: number;
  peakAtMs: number | null;
}

export interface SeriesPoint {
  readonly atMs: number;
  readonly counted: number;
  readonly file: number;
  readonly overlap: number;
  /** Each container's counted reading at this instant, by its index in
   * `containers`; absent when it was not read then. */
  readonly byContainer: ReadonlyMap<number, number>;
}

export interface SamplingFigures {
  readonly intervalMs: number;
  readonly discoveryMs: number;
  /** Wall clock when the sampler opened. */
  readonly startedAt: string;
  readonly durationMs: number;
  readonly engine: EngineFacts | null;
  readonly instants: number;
  /** The longest time between two instants. */
  readonly maxGapMs: number;
  /** Instants that came more than twice the interval after the one before. */
  readonly lateInstants: number;
  readonly listings: number;
  readonly listingErrors: number;
  readonly firstListingError: string | null;
  /** The longest time without a successful listing, from the sampler's
   * opening to its end; null when no listing ever succeeded. */
  readonly maxListingGapMs: number | null;
  /** Containers left unread because their cgroup is another's, one line
   * each. */
  readonly cgroupConflicts: readonly string[];
  readonly containers: readonly ContainerFigures[];
  readonly shares: readonly ShareFigures[];
  /** Containers outside every share, summed per instant. */
  readonly unshared: { peakCounted: number; peakAtMs: number | null };
  /** The deployment's peak by the budget's reading. */
  readonly peak: Instant | null;
  readonly overlap: {
    readonly instants: number;
    readonly peak: number;
    readonly peakAtMs: number | null;
  };
  /** Labelled moments the caller marked (`mark`). */
  readonly marks: readonly { label: string; atMs: number }[];
  readonly series: readonly SeriesPoint[];
}

export interface SamplerOptions {
  source: ContainerSource;
  locator: CgroupLocator;
  intervalMs?: number;
  /** How often the container list is read again. Default 1 s. */
  discoveryMs?: number;
  /** A monotonic clock in ms. */
  now?: () => number;
  /** Reads a cgroup's `memory.stat`. */
  read?: (dir: string) => MemoryReading;
  /** Finds a container's cgroup; `resolveContainerCgroup` by default. */
  resolve?: typeof resolveContainerCgroup;
  /** Warnings (a failed listing, an unreadable cgroup). */
  warn?: (line: string) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isGone(error: unknown): boolean {
  const code =
    error !== null && typeof error === 'object'
      ? Reflect.get(error, 'code')
      : undefined;
  return code === 'ENOENT' || code === 'ENODEV' || code === 'ESRCH';
}

function newFigures(
  container: DeploymentContainer,
  atMs: number,
): ContainerFigures {
  return {
    id: container.id,
    name: container.name,
    project: container.project,
    service: container.service,
    colour: container.colour,
    share: shareOf(container.service)?.key ?? null,
    cgroup: null,
    via: null,
    firstSeenMs: atMs,
    lastReadMs: null,
    goneMs: null,
    unresolved: null,
    samples: 0,
    peakCounted: 0,
    peakCountedAtMs: null,
    peakFields: null,
    fileAtPeak: 0,
    peakFile: 0,
    peakFileAtMs: null,
    lastCounted: null,
    readErrors: 0,
    firstReadError: null,
  };
}

export class BudgetSampler {
  readonly #source: ContainerSource;
  readonly #locator: CgroupLocator;
  readonly #intervalMs: number;
  readonly #discoveryMs: number;
  readonly #now: () => number;
  readonly #read: (dir: string) => MemoryReading;
  readonly #resolve: (
    locator: CgroupLocator,
    container: { id: string; pid: number; driver: string | null },
  ) => ResolvedCgroup | null;
  readonly #warn: (line: string) => void;

  #t0 = 0;
  #startedAt = '';
  #engine: EngineFacts | null = null;
  /** Every container ever listed, in the order first listed. */
  readonly #containers: ContainerFigures[] = [];
  readonly #byId = new Map<string, ContainerFigures>();
  /** The containers read at each instant. */
  readonly #active = new Set<ContainerFigures>();
  readonly #shares: ShareFigures[] = SHARES.map((share) => ({
    key: share.key,
    peakCounted: 0,
    peakAtMs: null,
  }));
  readonly #unshared = { peakCounted: 0, peakAtMs: null as number | null };
  readonly #overlap = { instants: 0, peak: 0, peakAtMs: null as number | null };
  readonly #marks: { label: string; atMs: number }[] = [];
  readonly #series: SeriesPoint[] = [];
  #peak: Instant | null = null;
  #last: Instant | null = null;
  #instants = 0;
  #lastInstantAt: number | null = null;
  #maxGapMs = 0;
  #lateInstants = 0;
  #listings = 0;
  #listingErrors = 0;
  #firstListingError: string | null = null;
  /** When the last listing succeeded. */
  #lastListingMs: number | null = null;
  #maxListingGapMs = 0;
  readonly #cgroupConflicts: string[] = [];
  #endMs: number | null = null;

  #running = false;
  #tickTimer: ReturnType<typeof setTimeout> | null = null;
  #listTimer: ReturnType<typeof setTimeout> | null = null;
  #listing: Promise<void> | null = null;
  #slot = 0;

  constructor(options: SamplerOptions) {
    this.#source = options.source;
    this.#locator = options.locator;
    this.#intervalMs = options.intervalMs ?? SAMPLE_INTERVAL_MS;
    this.#discoveryMs = options.discoveryMs ?? 1_000;
    this.#now = options.now ?? (() => performance.now());
    this.#read = options.read ?? readMemoryStat;
    this.#resolve = options.resolve ?? resolveContainerCgroup;
    this.#warn = options.warn ?? ((line) => console.warn(line));
  }

  /** ms since the sampler opened. */
  elapsedMs(): number {
    return this.#now() - this.#t0;
  }

  /**
   * Read what the engine says of itself and list the containers once; the
   * clock starts here.
   */
  async open(): Promise<void> {
    try {
      this.#engine = await this.#source.engine();
    } catch (error) {
      this.#warn(
        `[budget] the engine did not describe itself: ${errorText(error)}`,
      );
    }
    this.#t0 = this.#now();
    this.#startedAt = new Date().toISOString();
    await this.discover();
  }

  /** List the deployment's containers again and follow what changed. */
  async discover(): Promise<void> {
    let listed: DeploymentContainer[];
    try {
      listed = await this.#source.list();
    } catch (error) {
      this.#listingErrors += 1;
      const text = errorText(error);
      if (this.#firstListingError === null) {
        this.#firstListingError = text;
        this.#warn(`[budget] listing the containers failed: ${text}`);
      }
      return;
    }
    this.#listings += 1;
    const atMs = this.elapsedMs();
    this.#maxListingGapMs = Math.max(
      this.#maxListingGapMs,
      atMs - (this.#lastListingMs ?? 0),
    );
    this.#lastListingMs = atMs;
    const listedIds = new Set<string>();
    for (const container of listed) {
      listedIds.add(container.id);
      let figures = this.#byId.get(container.id);
      if (figures === undefined) {
        figures = newFigures(container, atMs);
        this.#byId.set(container.id, figures);
        this.#containers.push(figures);
      }
      if (this.#active.has(figures)) continue;
      const resolved = this.#resolve(this.#locator, {
        id: container.id,
        pid: container.pid,
        driver: this.#engine?.cgroupDriver ?? null,
      });
      if (resolved === null) {
        if (figures.unresolved === null) {
          figures.unresolved = `no cgroup with a memory.stat for process ${container.pid} or the ${this.#engine?.cgroupDriver ?? 'default'} driver's paths`;
          this.#warn(`[budget] ${container.name}: ${figures.unresolved}`);
        }
        continue;
      }
      const sharer = [...this.#active].find(
        (other) => other !== figures && other.cgroup === resolved.dir,
      );
      if (sharer !== undefined) {
        // One cgroup read for two containers counts its memory twice.
        if (figures.unresolved === null) {
          figures.unresolved = `its cgroup ${resolved.dir} is ${sharer.name}'s, read already: read for both, its memory would count twice`;
          this.#cgroupConflicts.push(
            `${container.name}: ${figures.unresolved}`,
          );
          this.#warn(`[budget] ${container.name}: ${figures.unresolved}`);
        }
        continue;
      }
      figures.cgroup = resolved.dir;
      figures.via = resolved.via;
      figures.unresolved = null;
      figures.goneMs = null;
      this.#active.add(figures);
    }
    for (const figures of this.#active) {
      if (listedIds.has(figures.id)) continue;
      figures.goneMs = atMs;
      this.#active.delete(figures);
    }
  }

  /** One instant: read every container now. */
  tick(): void {
    const atMs = this.elapsedMs();
    if (this.#lastInstantAt !== null) {
      const gap = atMs - this.#lastInstantAt;
      this.#maxGapMs = Math.max(this.#maxGapMs, gap);
      if (gap > 2 * this.#intervalMs) this.#lateInstants += 1;
    }
    this.#lastInstantAt = atMs;
    this.#instants += 1;

    let total = 0;
    let file = 0;
    const colours = new Map<Colour, number>();
    const shareSums = new Map<ShareKey | null, number>();
    const parts: InstantPart[] = [];
    const byContainer = new Map<number, number>();
    for (const [index, figures] of this.#containers.entries()) {
      if (!this.#active.has(figures) || figures.cgroup === null) continue;
      let reading: MemoryReading;
      try {
        reading = this.#read(figures.cgroup);
      } catch (error) {
        if (isGone(error)) {
          // It stopped since the last listing: it holds nothing any more.
          figures.goneMs = atMs;
          this.#active.delete(figures);
          continue;
        }
        figures.readErrors += 1;
        if (figures.firstReadError === null) {
          figures.firstReadError = errorText(error);
          this.#warn(
            `[budget] ${figures.name}: cannot read ${figures.cgroup}: ${figures.firstReadError}`,
          );
        }
        continue;
      }
      figures.samples += 1;
      figures.lastReadMs = atMs;
      figures.lastCounted = reading.counted;
      if (
        figures.peakCountedAtMs === null ||
        reading.counted > figures.peakCounted
      ) {
        figures.peakCounted = reading.counted;
        figures.peakCountedAtMs = atMs;
        figures.peakFields = { ...reading.fields };
        figures.fileAtPeak = reading.file;
      }
      if (figures.peakFileAtMs === null || reading.file > figures.peakFile) {
        figures.peakFile = reading.file;
        figures.peakFileAtMs = atMs;
      }
      total += reading.counted;
      file += reading.file;
      byContainer.set(index, reading.counted);
      parts.push({
        name: figures.name,
        service: figures.service,
        colour: figures.colour,
        counted: reading.counted,
        file: reading.file,
      });
      if (figures.share === 'app-tier' && figures.colour !== null) {
        colours.set(
          figures.colour,
          (colours.get(figures.colour) ?? 0) + reading.counted,
        );
      }
      shareSums.set(
        figures.share,
        (shareSums.get(figures.share) ?? 0) + reading.counted,
      );
    }

    const blue = colours.get('blue');
    const green = colours.get('green');
    const overlap =
      blue !== undefined && green !== undefined ? Math.min(blue, green) : 0;
    if (blue !== undefined && green !== undefined) {
      this.#overlap.instants += 1;
      if (this.#overlap.peakAtMs === null || overlap > this.#overlap.peak) {
        this.#overlap.peak = overlap;
        this.#overlap.peakAtMs = atMs;
      }
      shareSums.set('app-tier', (shareSums.get('app-tier') ?? 0) - overlap);
    }
    for (const share of this.#shares) {
      const sum = shareSums.get(share.key);
      if (sum === undefined) continue;
      if (share.peakAtMs === null || sum > share.peakCounted) {
        share.peakCounted = sum;
        share.peakAtMs = atMs;
      }
    }
    const unshared = shareSums.get(null);
    if (
      unshared !== undefined &&
      (this.#unshared.peakAtMs === null ||
        unshared > this.#unshared.peakCounted)
    ) {
      this.#unshared.peakCounted = unshared;
      this.#unshared.peakAtMs = atMs;
    }

    const instant: Instant = {
      atMs,
      counted: total - overlap,
      total,
      overlap,
      file,
      parts,
    };
    this.#last = instant;
    if (
      parts.length > 0 &&
      (this.#peak === null || instant.counted > this.#peak.counted)
    ) {
      this.#peak = instant;
    }
    this.#series.push({
      atMs,
      counted: instant.counted,
      file,
      overlap,
      byContainer,
    });
  }

  /** The newest instant, for progress lines. */
  latest(): Instant | null {
    return this.#last;
  }

  /** Note a moment of the run (the workload's start, its end). */
  mark(label: string): void {
    this.#marks.push({ label, atMs: this.elapsedMs() });
  }

  /** Read every interval and list every `discoveryMs` until `stop`. */
  run(): void {
    if (this.#running) return;
    this.#running = true;
    this.#slot = Math.floor(this.elapsedMs() / this.#intervalMs);
    this.tick();
    this.#scheduleTick();
    this.#scheduleListing();
  }

  #scheduleTick(): void {
    if (!this.#running) return;
    // The next slot on the interval's grid; slots a stalled loop missed are
    // skipped, never read in a burst that would sample one moment twice.
    this.#slot = Math.max(
      this.#slot + 1,
      Math.floor(this.elapsedMs() / this.#intervalMs) + 1,
    );
    const delay = Math.max(0, this.#slot * this.#intervalMs - this.elapsedMs());
    this.#tickTimer = setTimeout(() => {
      this.tick();
      this.#scheduleTick();
    }, delay);
  }

  #scheduleListing(): void {
    if (!this.#running) return;
    this.#listTimer = setTimeout(() => {
      this.#listing = this.discover().finally(() => {
        this.#listing = null;
        this.#scheduleListing();
      });
    }, this.#discoveryMs);
  }

  /** Stop reading; the figures as they stand. */
  async stop(): Promise<SamplingFigures> {
    this.#running = false;
    if (this.#tickTimer !== null) clearTimeout(this.#tickTimer);
    if (this.#listTimer !== null) clearTimeout(this.#listTimer);
    if (this.#listing !== null) await this.#listing;
    this.#endMs = this.elapsedMs();
    return this.figures();
  }

  figures(): SamplingFigures {
    const durationMs = this.#endMs ?? this.elapsedMs();
    return {
      intervalMs: this.#intervalMs,
      discoveryMs: this.#discoveryMs,
      startedAt: this.#startedAt,
      durationMs,
      engine: this.#engine,
      instants: this.#instants,
      maxGapMs: this.#maxGapMs,
      lateInstants: this.#lateInstants,
      listings: this.#listings,
      listingErrors: this.#listingErrors,
      firstListingError: this.#firstListingError,
      maxListingGapMs:
        this.#lastListingMs === null
          ? null
          : Math.max(this.#maxListingGapMs, durationMs - this.#lastListingMs),
      cgroupConflicts: [...this.#cgroupConflicts],
      containers: this.#containers,
      shares: this.#shares,
      unshared: { ...this.#unshared },
      peak: this.#peak,
      overlap: { ...this.#overlap },
      marks: this.#marks,
      series: this.#series,
    };
  }
}
