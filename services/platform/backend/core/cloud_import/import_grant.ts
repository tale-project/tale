/**
 * The grant a person's cloud import runs under, kept current file by file —
 * shared by both import pipelines (OneDrive/SharePoint, Google Drive).
 *
 * The import route reads the grant once, and an import of a few hundred
 * files runs for minutes: long enough for the grant to be revoked
 * (**Disconnect** in another tab, access removed at Microsoft or Google) or
 * to expire. Each listing reads the grant on every call; an import now reads
 * it again before each file, the same check, and asks for a new token once
 * more when the provider refuses the one a file's call carried (HTTP 401) —
 * access removed at the provider ends its token while the stored expiry
 * still counts it live. A grant that answers "reconnect" stops the import at
 * that file: the files before it stay, and the answer carries the grant's
 * own sentence, the one each listing hands to the connect dialog.
 */

/** What reading the grant answers — the routes' `GraphTokenResult`. */
export type ImportTokenResult =
  | { success: true; token: string }
  | { success: false; error: string; needsReauth?: boolean };

/** Read the grant again. `forceRefresh` asks the provider for a new token
 *  even when the stored one should still be live. */
export type ResolveImportToken = (options: {
  forceRefresh: boolean;
}) => Promise<ImportTokenResult>;

/** The provider refused the token a file's call carried (HTTP 401). */
export class ProviderTokenRefusedError extends Error {
  override readonly name = 'ProviderTokenRefusedError';
}

/** How long a grant that could not be read (a throttled or unreachable
 *  token endpoint, a database that did not answer) is left alone: reading
 *  it again before every file would ask the token endpoint once per file. */
const GRANT_QUIET_MS = 30_000;

export class ImportGrant {
  private token: string;
  private readonly resolve: ResolveImportToken | undefined;
  private readonly now: () => number;
  /** False once the provider refused a token it had just issued: it is not
   *  asked for another until a file's calls end in something else — never
   *  once per remaining file. */
  private mayRefresh = true;
  /** Until when (ms) the grant is not read again, after a read that could
   *  not be answered. */
  private quietUntil = 0;
  private endedWith: string | undefined;

  /** `resolve` absent (the sync engine): the token is used as it is. `now`
   *  is the clock the quiet window runs on. */
  constructor(
    token: string,
    resolve?: ResolveImportToken,
    now: () => number = Date.now,
  ) {
    this.token = token;
    this.resolve = resolve;
    this.now = now;
  }

  /** The grant's own sentence once it answered "reconnect"; the import
   *  stops at the file that met it. */
  get ended(): string | undefined {
    return this.endedWith;
  }

  /** Before a file: read the grant again. False once it has ended. */
  async beforeFile(): Promise<boolean> {
    if (this.endedWith !== undefined) return false;
    if (this.resolve === undefined || this.now() < this.quietUntil) {
      return true;
    }
    const current = await this.read(this.resolve, false);
    if (current.success) {
      this.token = current.token;
      return true;
    }
    if (current.needsReauth === true) {
      this.endedWith = current.error;
      return false;
    }
    // A grant that could not be read right now is no reason to stop: the
    // file tries the token it has.
    this.quiet(current.error);
    return true;
  }

  /**
   * One file's provider calls with the current token. When the provider
   * refuses it, the grant is refreshed and the calls run once more with the
   * new token; a grant that cannot be refreshed ends here (`ended`).
   */
  async run<T>(work: (token: string) => Promise<T>): Promise<T> {
    try {
      return await this.attempt(work, this.token);
    } catch (error) {
      if (
        !(error instanceof ProviderTokenRefusedError) ||
        this.resolve === undefined ||
        !this.mayRefresh ||
        this.now() < this.quietUntil
      ) {
        throw error;
      }
      const renewed = await this.read(this.resolve, true);
      if (!renewed.success) {
        if (renewed.needsReauth === true) this.endedWith = renewed.error;
        else this.quiet(renewed.error);
        throw error;
      }
      this.token = renewed.token;
      this.mayRefresh = false;
      return this.attempt(work, renewed.token);
    }
  }

  /** One run of the calls: an end other than a refused token re-arms the
   *  refresh. */
  private async attempt<T>(
    work: (token: string) => Promise<T>,
    token: string,
  ): Promise<T> {
    try {
      const done = await work(token);
      this.mayRefresh = true;
      return done;
    } catch (error) {
      if (!(error instanceof ProviderTokenRefusedError)) {
        this.mayRefresh = true;
      }
      throw error;
    }
  }

  /** One read of the grant. A read that throws — a database blip, a token
   *  endpoint that did not answer — could not be answered right now: it
   *  neither ends the import nor aborts it. */
  private async read(
    resolve: ResolveImportToken,
    forceRefresh: boolean,
  ): Promise<ImportTokenResult> {
    try {
      return await resolve({ forceRefresh });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'the read threw',
        needsReauth: false,
      };
    }
  }

  private quiet(reason: string): void {
    this.quietUntil = this.now() + GRANT_QUIET_MS;
    console.warn(
      `[importFiles] could not read the grant again (${reason}); trying again in ${GRANT_QUIET_MS / 1000} s`,
    );
  }
}

/** Why one file was not imported, in words a person can read: a refusal
 *  Tale wrote for people (the size cap), never a provider's answer. */
export interface ImportFileReason {
  code: string;
  message: string;
}

/** One file refused with a reason a person can read. */
export class ImportFileRefusal extends Error {
  override readonly name = 'ImportFileRefusal';
  readonly reason: ImportFileReason;

  constructor(reason: ImportFileReason) {
    super(reason.message);
    this.reason = reason;
  }
}
