/**
 * One virtual user: a person of some persona, signed in, with a dashboard
 * tab open on one of their organizations.
 *
 * The user owns its session lifecycle — authenticate (adopt the seeded
 * session or sign in with the password), run the dashboard's boot
 * waterfall, hold the organization's `/events` stream, and later "close
 * the tab" and come back fresh — and the reactions every request may
 * trigger: a 401 re-authenticates, a 429 waits out its `Retry-After`, a
 * 5xx or a dropped connection backs off exponentially. Journeys (what the
 * person does) live in `journeys/`; they call {@link VirtualUser.guard}
 * and {@link VirtualUser.pause} between steps, which is where a stop, a
 * lapsed session or a back-off interrupts them.
 */

import {
  getSession,
  recordOrganizationSwitch,
  setActiveOrganization,
  signInEmail,
  signOut,
} from '../api/auth.ts';
import { listThreads } from '../api/chat.ts';
import {
  ApiClient,
  type ApiObserver,
  HeldRequester,
  type Requester,
  discardingMetrics,
} from '../api/client.ts';
import {
  type Hint,
  type ThreadEvent,
  type StreamTarget,
  openOrgEvents,
  openThreadStream,
} from '../api/realtime.ts';
import {
  type ComposerModel,
  automationsListing,
  composerModels,
  conversationApiSources,
  currentUser,
  lastActiveOrganization,
  memberContext,
  myOrganizations,
  myTeams,
  passwordExpiry,
  spaShell,
  twoFactorStatus,
  userPreferences,
} from '../api/shell.ts';
import {
  OPEN_TASK_STATUSES,
  listProjectBoard,
  listTasksAcrossProjects,
} from '../api/tasks.ts';
import {
  listProjects,
  myUnreadCount,
  orgUnreadCount,
} from '../api/workspace.ts';
import {
  HttpClient,
  type EventStreamHandle,
  type HttpResponse,
  UserSession,
} from '../client/index.ts';
import { UserFaker, drawLocale } from '../data/faker.ts';
import { type Random, chance, exponential } from '../data/random.ts';
import type { MetricsRegistry } from '../metrics/index.ts';
import {
  type PlanMemberRole,
  type PlanOrganization,
  isMegaOrgMember,
  megaOrganizationIndex,
  memberRoleFor,
  organizationIndexFor,
  sessionTokenFor,
  userEmail,
} from '../plan.ts';
import type { PersonaName, VirtualUserContext } from './contract.ts';
import { createHintReceiver, hintRegistry } from './registry.ts';
import { type PauseKind, pauseMs, retryAfterMs, sleep } from './think.ts';

/** Why a journey stopped before its end. */
export type InterruptReason = 'aborted' | 'unauthorized' | 'server_errors';

export class JourneyInterrupted extends Error {
  readonly reason: InterruptReason;

  constructor(reason: InterruptReason) {
    super(`journey interrupted: ${reason}`);
    this.name = 'JourneyInterrupted';
    this.reason = reason;
  }
}

/** A membership the user holds: the organization and the role in it. */
export interface Seat {
  readonly org: PlanOrganization;
  readonly role: PlanMemberRole;
  readonly mega: boolean;
}

/** Roles that write shared content (projects, contacts, documents). */
const EDITOR_ROLES: ReadonlySet<PlanMemberRole> = new Set([
  'owner',
  'admin',
  'developer',
  'editor',
]);
/** Roles that read the audit log. */
const ADMIN_ROLES: ReadonlySet<PlanMemberRole> = new Set(['owner', 'admin']);
/** Roles that may create a personal API key. */
const KEY_ROLES: ReadonlySet<PlanMemberRole> = new Set([
  'owner',
  'admin',
  'developer',
]);

/** What the user remembers about one organization between journeys. */
export interface OrgMemory {
  threads: string[];
  /** Tasks this user created (they may work them whatever their role). */
  myTasks: string[];
  /** Tasks last seen on a board. */
  boardTasks: string[];
  /** Keywords of documents this user uploaded, for later searches. */
  keywords: string[];
  notifications: string[];
}

const MEMORY_CAP = 40;

/** Push to the front of a bounded most-recent-first list. */
export function remember(list: string[], value: string): void {
  const at = list.indexOf(value);
  if (at !== -1) list.splice(at, 1);
  list.unshift(value);
  if (list.length > MEMORY_CAP) list.length = MEMORY_CAP;
}

export function forget(list: string[], value: string): void {
  const at = list.indexOf(value);
  if (at !== -1) list.splice(at, 1);
}

/** The screen the tab shows: decides which reads a hint refetches. */
export type Screen = 'home' | 'chat' | 'board' | 'other';

/** The SPA shell lives on a separate web tier when this names one. */
const WEB_URL = process.env.TALE_LOAD_WEB_URL?.trim() || null;

/** Coalesce hint-driven refetches per entity at most this often. */
const REFETCH_MIN_INTERVAL_MS = 2_000;

/** The ceiling of a server-error back-off. */
const MAX_SERVER_BACKOFF_MS = 30_000;
/** The ceiling of a rate-limit back-off. */
const MAX_RATE_LIMIT_BACKOFF_MS = 120_000;

type SessionKind = 'minted' | 'password';

export class VirtualUser implements ApiObserver {
  readonly ctx: VirtualUserContext;
  readonly random: Random;
  readonly data: UserFaker;
  readonly metrics: MetricsRegistry;
  readonly signal: AbortSignal;
  readonly persona: PersonaName;
  readonly index: number;
  readonly email: string;
  readonly homeSeat: Seat | null;
  readonly megaSeat: Seat | null;

  /** The organization the tab shows. */
  seat: Seat | null;
  session: UserSession;
  api: ApiClient;
  /** The same session for requests held open for a whole operation. */
  heldApi: ApiClient;
  web: ApiClient | null = null;
  userId: string | undefined;
  /** What the composer offers, and the model this user sends to. */
  models: ComposerModel[] = [];
  model: ComposerModel | null = null;
  screen: Screen = 'home';
  /** The project whose board is on screen. */
  boardProjectId: string | null = null;
  /** Uploads met an unconfigured object store: stop trying. */
  uploadsUnavailable = false;
  /** Knowledge search met an unconfigured index: stop trying. */
  knowledgeUnavailable = false;

  readonly #memory = new Map<string, OrgMemory>();
  /** The task writes this tab already measured the hint latency of. */
  readonly #hintReceiver = createHintReceiver();
  #sessionKind: SessionKind = 'minted';
  #mintedInvalid = false;
  #unauthorized = false;
  #backoffUntil = 0;
  #backoffForServer = false;
  #serverFailures = 0;
  #events: EventStreamHandle | null = null;
  #thread: { id: string; handle: EventStreamHandle; ready: boolean } | null =
    null;
  #threadListener: ((event: ThreadEvent) => void) | null = null;
  #threadReadyWaiters: (() => void)[] = [];
  readonly #refetchDue = new Map<string, number>();
  readonly #refetchTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(ctx: VirtualUserContext) {
    this.ctx = ctx;
    this.random = ctx.random;
    this.metrics = ctx.metrics;
    this.signal = ctx.signal;
    this.persona = ctx.persona;
    this.index = ctx.index;
    this.email = userEmail(ctx.plan, ctx.index);
    this.data = new UserFaker(ctx.random, drawLocale(ctx.random));
    this.homeSeat = seatFor(
      ctx,
      organizationIndexFor(ctx.plan, ctx.index),
      false,
    );
    this.megaSeat = isMegaOrgMember(ctx.plan, ctx.index)
      ? seatFor(ctx, megaOrganizationIndex(ctx.plan), true)
      : null;
    this.seat = this.homeSeat ?? this.megaSeat;
    this.session = this.#newSession();
    this.api = this.#newApi(this.session);
    this.heldApi = this.#newHeldApi(this.session);
  }

  // -------------------------------------------------------------------------
  // Identity and permissions
  // -------------------------------------------------------------------------

  get orgId(): string {
    return this.seat?.org.id ?? '';
  }

  get role(): PlanMemberRole {
    return this.seat?.role ?? 'member';
  }

  get canEdit(): boolean {
    return EDITOR_ROLES.has(this.role);
  }

  get canReadAudit(): boolean {
    return ADMIN_ROLES.has(this.role);
  }

  /** May create a personal API key: a key-holding role in ANY seat. */
  get canCreateApiKeys(): boolean {
    return [this.homeSeat, this.megaSeat].some(
      (seat) => seat !== null && KEY_ROLES.has(seat.role),
    );
  }

  /** This organization's memory (threads, tasks, uploads). */
  memory(orgId: string = this.orgId): OrgMemory {
    let memory = this.#memory.get(orgId);
    if (memory === undefined) {
      memory = {
        threads: [],
        myTasks: [],
        boardTasks: [],
        keywords: [],
        notifications: [],
      };
      this.#memory.set(orgId, memory);
    }
    return memory;
  }

  get options(): VirtualUserContext['options'] {
    return this.ctx.options;
  }

  // -------------------------------------------------------------------------
  // Pacing and interruption
  // -------------------------------------------------------------------------

  /**
   * Between two steps: stop when the user was stopped or lost its session;
   * wait out a pending back-off (and abandon the journey after server
   * errors — what it was doing may not have happened).
   */
  async guard(): Promise<void> {
    if (this.signal.aborted) throw new JourneyInterrupted('aborted');
    if (this.#unauthorized) throw new JourneyInterrupted('unauthorized');
    const wait = this.#backoffUntil - performance.now();
    if (wait > 0) {
      const forServer = this.#backoffForServer;
      await sleep(wait, this.signal);
      if (this.signal.aborted) throw new JourneyInterrupted('aborted');
      if (forServer) throw new JourneyInterrupted('server_errors');
    }
  }

  /** A human pause of `kind`, then {@link guard}. */
  async pause(kind: PauseKind, factor = 1): Promise<void> {
    await sleep(
      pauseMs(this.random, kind, this.options.thinkTimeScale * factor),
      this.signal,
    );
    await this.guard();
  }

  /** Wait `ms` (already scaled), then {@link guard}. */
  async wait(ms: number): Promise<void> {
    await sleep(ms, this.signal);
    await this.guard();
  }

  /** Every response of this user passes here (the {@link ApiObserver}). */
  onResponse(name: string, response: HttpResponse<unknown>): void {
    const status = response.status;
    if (status >= 200 && status < 400) {
      this.#serverFailures = 0;
      return;
    }
    if (status === 401 && !name.startsWith('POST /api/auth/sign-in')) {
      this.#unauthorized = true;
      this.metrics.counter('session.unauthorized');
      return;
    }
    if (status === 429) {
      const asked = retryAfterMs(response.header('retry-after'));
      const delay = Math.min(
        MAX_RATE_LIMIT_BACKOFF_MS,
        (asked ?? 5_000) + this.random() * 1_000,
      );
      this.#setBackoff(delay, false);
      this.metrics.counter('backoff.rate_limited');
      return;
    }
    if (status === 0 || status >= 500) {
      this.#serverFailures += 1;
      const ceiling = Math.min(
        MAX_SERVER_BACKOFF_MS,
        1_000 * 2 ** Math.min(this.#serverFailures - 1, 10),
      );
      this.#setBackoff(ceiling / 2 + this.random() * (ceiling / 2), true);
      this.metrics.counter('backoff.server_error');
    }
  }

  #setBackoff(ms: number, forServer: boolean): void {
    const until = performance.now() + ms;
    if (until > this.#backoffUntil) {
      this.#backoffUntil = until;
      this.#backoffForServer = forServer;
    }
  }

  // -------------------------------------------------------------------------
  // Session lifecycle
  // -------------------------------------------------------------------------

  #newSession(): UserSession {
    return new UserSession({
      baseUrl: this.ctx.baseUrl,
      agent: this.ctx.agent,
      metrics: this.metrics,
      email: this.email,
      password: this.ctx.plan.users.password,
      timeoutMs: this.ctx.options.requestTimeoutMs,
      ...(this.ctx.forwardedFor === null
        ? {}
        : { forwardedFor: this.ctx.forwardedFor }),
    });
  }

  #newApi(requester: Requester): ApiClient {
    return new ApiClient({ requester, signal: this.signal, observer: this });
  }

  /** Held requests share the session's cookie jar, record as timings. */
  #newHeldApi(session: UserSession): ApiClient {
    const http = new HttpClient({
      baseUrl: this.ctx.baseUrl,
      agent: this.ctx.agent,
      metrics: discardingMetrics(),
      cookies: session.cookies,
      timeoutMs: this.ctx.options.turnTimeoutMs,
      ...(this.ctx.forwardedFor === null
        ? {}
        : { forwardedFor: this.ctx.forwardedFor }),
    });
    return this.#newApi(new HeldRequester(http, this.metrics));
  }

  /** The pieces an event stream needs to authenticate as this user. */
  get streamTarget(): StreamTarget {
    return {
      agent: this.ctx.agent,
      baseUrl: this.ctx.baseUrl,
      metrics: this.metrics,
      headers: () => this.session.streamHeaders(),
      random: this.random,
    };
  }

  /**
   * Start a session: authenticate, run the boot waterfall, open the hint
   * stream. `false` when the user could not get in (it backs off first).
   */
  async startSession(): Promise<boolean> {
    this.session = this.#newSession();
    this.api = this.#newApi(this.session);
    this.heldApi = this.#newHeldApi(this.session);
    this.web = this.#webClient();
    this.#unauthorized = false;
    if (this.web !== null) await spaShell(this.web, '/');
    if (!(await this.#authenticate(false))) return false;
    const view = await getSession(this.api);
    // A failed probe (network, 5xx) says nothing about the session: back
    // off and start over rather than writing the seeded session off.
    if (!view.ok) return false;
    let sessionView = view.body;
    if (sessionView === undefined && this.#sessionKind === 'minted') {
      // The seeded session is gone (expired, or revoked by a sign-out):
      // from now on this person signs in like everyone else.
      this.#mintedInvalid = true;
      this.metrics.counter('auth.minted_session_invalid');
      if (!(await this.#authenticate(true))) return false;
      sessionView = (await getSession(this.api)).body;
    }
    if (sessionView === undefined) {
      this.metrics.error(
        'session',
        'no_session',
        `${this.email}: get-session answered no session`,
      );
      return false;
    }
    this.userId = sessionView.userId;
    this.metrics.counter('session.started');
    await this.#bootDashboard(sessionView.activeOrganizationId);
    return !this.signal.aborted;
  }

  /** Adopt the seeded session, or sign in with the password. */
  async #authenticate(forcePassword: boolean): Promise<boolean> {
    const secret = this.ctx.authSecret;
    const canAdopt =
      this.ctx.plan.users.sessionsMinted &&
      secret !== null &&
      !this.#mintedInvalid;
    if (
      !forcePassword &&
      canAdopt &&
      !chance(this.random, this.options.passwordSignInRate)
    ) {
      this.session.adoptSessionToken(
        sessionTokenFor(secret, this.ctx.plan.runId, this.index),
        secret,
      );
      this.#sessionKind = 'minted';
      this.metrics.counter('auth.adopted');
      return true;
    }
    this.session.cookies.clear();
    const result = await signInEmail(
      this.api,
      this.email,
      this.ctx.plan.users.password,
    );
    if (
      result.ok &&
      this.session.signedIn &&
      result.body?.twoFactorRedirect !== true
    ) {
      this.#sessionKind = 'password';
      this.metrics.counter('auth.password');
      return true;
    }
    if (!result.aborted) {
      this.metrics.counter('auth.sign_in_failed');
      if (result.status !== 429) {
        // The client recorded an unexpected status; a 200 without a cookie
        // or a second-factor challenge would otherwise go unexplained.
        if (result.ok) {
          this.metrics.error(
            'POST /api/auth/sign-in/email',
            result.body?.twoFactorRedirect === true
              ? 'two_factor_challenge'
              : 'no_session_cookie',
            this.email,
          );
        }
        this.#setBackoff(5_000 + this.random() * 10_000, false);
      }
    }
    return false;
  }

  /** After a 401: get a new session and pick up where the tab was. */
  async reauthenticate(): Promise<boolean> {
    this.metrics.counter('auth.reauthenticate');
    this.closeStreams();
    this.#unauthorized = false;
    if (this.#sessionKind === 'minted') this.#mintedInvalid = true;
    if (!(await this.#authenticate(true))) return false;
    const view = await getSession(this.api);
    if (view.body === undefined) return false;
    this.userId = view.body.userId;
    if (this.seat !== null) {
      if (view.body.activeOrganizationId !== this.seat.org.id) {
        await setActiveOrganization(this.api, this.seat.org.id);
      }
      this.#openEvents();
    }
    return true;
  }

  /** "Close the tab": streams down; a password session sometimes signs out. */
  async endSession(): Promise<void> {
    this.closeStreams();
    this.metrics.counter('session.ended');
    // Never sign out of the seeded session: it would revoke it for every
    // later session of this user, which would then all sign in through the
    // per-address rate limit.
    if (
      !this.signal.aborted &&
      this.#sessionKind === 'password' &&
      this.session.signedIn &&
      chance(this.random, 0.5)
    ) {
      await signOut(this.api);
    }
  }

  /** A fresh session's length, or `Infinity` for one that never ends. */
  sessionLengthMs(): number {
    const mean = this.options.sessionSeconds;
    return mean > 0
      ? exponential(this.random, mean * 1_000)
      : Number.POSITIVE_INFINITY;
  }

  get unauthorized(): boolean {
    return this.#unauthorized;
  }

  /** Remaining back-off, for the loop between journeys. */
  get backoffRemainingMs(): number {
    return Math.max(0, this.#backoffUntil - performance.now());
  }

  #webClient(): ApiClient | null {
    if (WEB_URL === null) return null;
    return this.#newApi(
      new HttpClient({
        baseUrl: WEB_URL,
        agent: this.ctx.agent,
        metrics: this.metrics,
        cookies: this.session.cookies,
        timeoutMs: this.options.requestTimeoutMs,
        ...(this.ctx.forwardedFor === null
          ? {}
          : { forwardedFor: this.ctx.forwardedFor }),
      }),
    );
  }

  // -------------------------------------------------------------------------
  // The dashboard
  // -------------------------------------------------------------------------

  /** `/dashboard`: the account gates, then the organization picker. */
  async #bootDashboard(
    activeOrganizationId: string | undefined,
  ): Promise<void> {
    await Promise.all([
      twoFactorStatus(this.api),
      passwordExpiry(this.api),
      currentUser(this.api),
    ]);
    const [, lastActive] = await Promise.all([
      myOrganizations(this.api),
      lastActiveOrganization(this.api),
    ]);
    const seats = [this.homeSeat, this.megaSeat].filter(
      (seat): seat is Seat => seat !== null,
    );
    const pointer = lastActive.body ?? activeOrganizationId;
    const seat =
      seats.find((candidate) => candidate.org.id === pointer) ??
      seats[0] ??
      null;
    if (seat === null) {
      this.metrics.counter('session.no_organization');
      return;
    }
    await this.enterOrganization(seat, activeOrganizationId);
  }

  /**
   * `/dashboard/$id`: the member context and teams, the active-org sync
   * (set-active + the switch stamp) when the session points elsewhere, the
   * hint stream, then Home.
   */
  async enterOrganization(
    seat: Seat,
    sessionActiveOrgId: string | undefined,
  ): Promise<void> {
    const switching = this.seat?.org.id !== seat.org.id;
    this.seat = seat;
    this.closeStreams();
    if (this.web !== null) {
      await spaShell(this.web, `/dashboard/${encodeURIComponent(seat.org.id)}`);
    }
    const [context] = await Promise.all([
      memberContext(this.api, seat.org.id),
      myTeams(this.api, seat.org.id),
    ]);
    if (context.ok && context.body?.status !== 'ok') {
      this.metrics.error(
        'GET /api/app/members/me',
        `member_${context.body?.status ?? 'unknown'}`,
        `${this.email} in ${seat.org.slug}`,
      );
    }
    if (sessionActiveOrgId !== seat.org.id || switching) {
      const set = await setActiveOrganization(this.api, seat.org.id);
      if (set.ok) await recordOrganizationSwitch(this.api, seat.org.id);
    }
    this.#openEvents();
    this.screen = 'home';
    await this.homeReads();
  }

  /** Every read Home fires when it mounts. */
  async homeReads(): Promise<void> {
    const orgId = this.orgId;
    if (orgId === '') return;
    const [threads, , , , , , , models] = await Promise.all([
      listThreads(this.api, orgId),
      listProjects(this.api, orgId),
      this.#homeTaskReads(),
      userPreferences(this.api, orgId),
      orgUnreadCount(this.api, orgId),
      myUnreadCount(this.api, orgId),
      automationsListing(this.api, orgId),
      composerModels(this.api, orgId),
      conversationApiSources(this.api, orgId),
    ]);
    if (threads.body !== undefined) {
      const memory = this.memory(orgId);
      memory.threads = threads.body.slice(0, MEMORY_CAP).map((row) => row.id);
    }
    if (models.body !== undefined) this.#chooseModel(models.body);
  }

  async #homeTaskReads(): Promise<void> {
    const userId = this.userId;
    if (userId === undefined) return;
    await Promise.all([
      listTasksAcrossProjects(this.api, this.orgId, {
        statuses: OPEN_TASK_STATUSES,
        assigneeId: userId,
      }),
      listTasksAcrossProjects(this.api, this.orgId, {
        status: 'in_review',
        reviewerId: userId,
      }),
    ]);
  }

  #chooseModel(models: ComposerModel[]): void {
    this.models = models;
    const org = this.seat?.org;
    const preferred = models.find(
      (model) =>
        model.id === org?.modelId &&
        (org.providerSlug === null || model.providerSlug === org.providerSlug),
    );
    this.model = preferred ?? models[0] ?? null;
  }

  /** The other organization of a person in two, if they have one. */
  otherSeat(): Seat | null {
    const current = this.seat?.org.id;
    const other = [this.homeSeat, this.megaSeat].find(
      (seat) => seat !== null && seat.org.id !== current,
    );
    return other ?? null;
  }

  // -------------------------------------------------------------------------
  // Realtime
  // -------------------------------------------------------------------------

  #openEvents(): void {
    if (!this.options.realtime || this.seat === null) return;
    this.#events?.close();
    this.#events = openOrgEvents(this.streamTarget, this.seat.org.id, {
      onHint: (hint) => this.#onHint(hint),
      onResync: () => this.#scheduleRefetch('resync'),
    });
  }

  #onHint(hint: Hint): void {
    this.metrics.counter('realtime.hints');
    if (hint.entity === 'task' && hint.entityId !== null) {
      hintRegistry.observeHint(this.metrics, hint.entityId, this.#hintReceiver);
    }
    this.#scheduleRefetch(hint.entity);
  }

  /**
   * A hint invalidates the tab's reads of its entity; the ones on screen
   * refetch, as react-query does. Coalesced per entity so a burst of hints
   * costs one refetch.
   */
  #scheduleRefetch(entity: string): void {
    const read = this.#refetchFor(entity);
    if (read === null || this.signal.aborted) return;
    const now = performance.now();
    const due = this.#refetchDue.get(entity);
    if (due !== undefined && due > now) return;
    const delay = 100 + this.random() * 400;
    this.#refetchDue.set(
      entity,
      now + Math.max(delay, REFETCH_MIN_INTERVAL_MS),
    );
    const timer = setTimeout(() => {
      this.#refetchTimers.delete(timer);
      if (this.signal.aborted || this.#unauthorized) return;
      this.metrics.counter('realtime.refetches');
      read().catch((error: unknown) => {
        this.metrics.error('scenario', 'refetch_failed', String(error));
      });
    }, delay);
    this.#refetchTimers.add(timer);
  }

  #refetchFor(entity: string): (() => Promise<unknown>) | null {
    const orgId = this.orgId;
    if (orgId === '') return null;
    switch (entity) {
      case 'task':
        if (this.screen === 'home') return () => this.#homeTaskReads();
        if (this.screen === 'board' && this.boardProjectId !== null) {
          const projectId = this.boardProjectId;
          return () => listProjectBoard(this.api, orgId, projectId);
        }
        return null;
      case 'chat_thread':
        return this.screen === 'home' || this.screen === 'chat'
          ? () => listThreads(this.api, orgId)
          : null;
      case 'notification':
        return () =>
          Promise.all([
            orgUnreadCount(this.api, orgId),
            myUnreadCount(this.api, orgId),
          ]);
      case 'project':
        return this.screen === 'home'
          ? () => listProjects(this.api, orgId)
          : null;
      case 'resync':
        return this.screen === 'home' ? () => this.homeReads() : null;
      default:
        return null;
    }
  }

  /** Put a thread on screen: hold its progress lane. */
  openThread(threadId: string): void {
    this.screen = 'chat';
    if (!this.options.threadStreams || this.seat === null) return;
    if (this.#thread?.id === threadId) return;
    this.closeThread();
    const entry = {
      id: threadId,
      ready: false,
      handle: openThreadStream(
        this.streamTarget,
        this.seat.org.id,
        threadId,
        (event) => {
          if (!entry.ready) {
            entry.ready = true;
            const waiters = this.#threadReadyWaiters;
            this.#threadReadyWaiters = [];
            for (const wake of waiters) wake();
          }
          this.#threadListener?.(event);
        },
      ),
    };
    this.#thread = entry;
  }

  /** Whether the thread's lane is open and has spoken at least once. */
  threadStreamReady(threadId: string): boolean {
    return this.#thread?.id === threadId && this.#thread.ready;
  }

  /** Wait (bounded) for the open thread lane's first event. */
  async waitThreadReady(timeoutMs: number): Promise<boolean> {
    const thread = this.#thread;
    if (thread === null) return false;
    if (thread.ready) return true;
    const signal = this.signal;
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.#threadReadyWaiters.push(done);
      signal.addEventListener('abort', done, { once: true });
    });
    return this.#thread?.ready === true;
  }

  /** Route the open thread lane's events to `listener` (one at a time). */
  listenThread(listener: ((event: ThreadEvent) => void) | null): void {
    this.#threadListener = listener;
  }

  closeThread(): void {
    this.#threadListener = null;
    this.#thread?.handle.close();
    this.#thread = null;
    const waiters = this.#threadReadyWaiters;
    this.#threadReadyWaiters = [];
    for (const wake of waiters) wake();
  }

  closeStreams(): void {
    this.closeThread();
    this.#events?.close();
    this.#events = null;
    for (const timer of this.#refetchTimers) clearTimeout(timer);
    this.#refetchTimers.clear();
    this.#refetchDue.clear();
  }
}

function seatFor(
  ctx: VirtualUserContext,
  orgIndex: number | null,
  mega: boolean,
): Seat | null {
  if (orgIndex === null) return null;
  const org = ctx.plan.organizations.list.find(
    (entry) => entry.index === orgIndex,
  );
  if (org === undefined) return null;
  const role = memberRoleFor(ctx.plan, orgIndex, ctx.index);
  return role === null ? null : { org, role, mega };
}
