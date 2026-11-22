'use node';

/**
 * yt-dlp for the video-link ingest pipeline: what a run is asked for, how
 * its end is judged, and the places it runs in.
 *
 * A run happens in a {@link YtdlpPlace}. A deployment's is a sandbox session
 * (`session_place.ts`): yt-dlp fetches pages and streams from whatever a
 * member pastes and runs a platform's JavaScript to get at them, and it
 * does that under the sandbox's rules and the host's admission, never as a
 * child of the application (tale-project/tale#4942). A developer's own
 * machine and the tests run it as a child of this process
 * ({@link createLocalYtdlpPlace}, array-form `spawn`, no shell, a
 * wall-clock timeout with `SIGTERM` then `SIGKILL` to its process group).
 * Either way a run downloads and converts nothing: no ffmpeg is involved.
 *
 * Hardening (from C4 sub-agent audit + 2024-25 yt-dlp CVE class):
 *   - `--no-config --no-exec --no-update --ignore-config`: neutralize
 *     CVE-2024-22423 `--exec` injection and config-file hijacks.
 *   - `--restrict-filenames`: yt-dlp's own filename sanitizer (mitigates
 *     CVE-2024-38519 path-traversal class).
 *   - `--paths home:<dir> --paths temp:<dir>`: every yt-dlp file write
 *     stays inside the place's directory. The output templates
 *     (`media.%(ext)s`, `subs.%(ext)s`) are fixed by us, never derived from
 *     metadata (template injection).
 *   - `--downloader native`: avoid yt-dlp falling through to ffmpeg-as-
 *     downloader (CVE-2023-35934 cookie leak class) or aria2.
 *   - A child of this process gets an `env` stripped to
 *     `{ PATH, HOME: <dir>, LANG: 'C.UTF-8' }` only: no secrets, no LD_*,
 *     no NODE_*. A session holds none of this process's environment at all.
 *   - What a run leaves is taken only under a name the lane asked for, of
 *     one path segment, and a place of this machine checks by `realpath`
 *     that the file lies in its directory.
 *
 * The pinned yt-dlp, its JavaScript runtime and the PO-token plugin are
 * installed, checksum-verified, in the sandbox runtime image
 * (`services/sandbox-runtime/Dockerfile`).
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { outboundProxyRotation } from '../../../lib/net/outbound-proxy';
import type {
  ProxyRotation,
  RotatedProxy,
} from '../../../lib/net/proxy-rotation';
import {
  isVideoProxyScheme,
  videoIngestProxyRotation,
} from '../../../lib/net/video-ingest-proxies';
import { fileBody } from '../lib/storage/object_store';
import { RELAY_PROXY_UNREACHABLE_STATUS } from './relay';

const YTDLP_BIN = 'yt-dlp';

/**
 * Where the sandbox runtime image carries the bgutil PO-token-provider yt-dlp
 * plugin (`services/sandbox-runtime/Dockerfile`), and the compose sidecar
 * (`bgutil-provider`) that serves the tokens. A session's yt-dlp is told
 * where the plugin is and asks the sidecar through the platform's relay
 * (`session_place.ts`). The sidecar runs only where a deployment turned it on
 * (`VIDEO_INGEST_POT_PROVIDER=true`), with nothing else to set;
 * `VIDEO_INGEST_POT_PROVIDER_URL` names another provider.
 *
 * A run on this machine (`VIDEO_INGEST_LANE=local`) finds the plugin here
 * only where this path exists, which it does on no ordinary machine: `bun
 * dev` and the live test name the directory of the toolchain they
 * provisioned (`VIDEO_INGEST_YTDLP_PLUGIN_DIRS`). Looked at once, when the
 * module loads.
 *
 * Layout under this root MUST be `bgutil/yt_dlp_plugins/…` (not a bare
 * `yt_dlp_plugins/`): yt-dlp `--plugin-dirs` iterates children of this path.
 * See `BGUTIL_PLUGIN_NEST_DIR` in `ytdlp_toolchain.ts` and the Dockerfile.
 */
export const BAKED_YTDLP_PLUGIN_DIR = '/opt/yt-dlp/plugins';
const DEFAULT_POT_PROVIDER_URL = 'http://bgutil-provider:4416';
const HAS_BAKED_YTDLP_PLUGIN = existsSync(BAKED_YTDLP_PLUGIN_DIR);

/** Which place a deployment's videos are fetched in. */
export type VideoIngestLane = 'sandbox' | 'local';

/**
 * `VIDEO_INGEST_LANE`: `sandbox` unless it says `local`. `local` is for a
 * machine that has yt-dlp itself and no sandbox to run it in: `bun dev`,
 * which provisions the tools, and the tests. A deployment's image carries
 * no yt-dlp, so there it would find none.
 */
export function videoIngestLane(
  env: NodeJS.ProcessEnv = process.env,
): VideoIngestLane {
  return env.VIDEO_INGEST_LANE?.trim().toLowerCase() === 'local'
    ? 'local'
    : 'sandbox';
}

/** Whether a run has the PO-token plugin at hand: always in a sandbox
 * session, whose image carries it, and on this machine where its directory
 * exists. */
function pluginAtHand(env: NodeJS.ProcessEnv): boolean {
  return videoIngestLane(env) === 'sandbox' || HAS_BAKED_YTDLP_PLUGIN;
}

// Flags supported by every yt-dlp release we care about (≥ 2024.04).
export const BASE_FLAGS: ReadonlyArray<string> = [
  '--no-config',
  // NOTE: `--no-call-home` was removed in yt-dlp 2025.xx (deprecated since
  // 2024) — emitting it spams stderr and the deprecation message can land
  // in the JSON output stream, breaking `-J` parsers downstream. Leaving
  // it out: `--no-config` + `--ignore-config` already neutralize any
  // call-home behavior configured via user config.
  '--no-exec',
  '--no-update',
  '--ignore-config',
  '--no-playlist',
  '--no-warnings',
  '--no-progress',
  '--no-mtime',
  '--socket-timeout',
  '30',
  // SSRF subprocess-layer defense. Pre-resolve in `url_safety.ts` walks
  // every A/AAAA record, but yt-dlp's own resolver runs independently
  // when it spawns. Restricting to IPv4 narrows the TOCTOU rebind window.
  '--force-ipv4',
  '--restrict-filenames',
  // A run that moves to another proxy runs again in the same job dir: start
  // every download over instead of resuming the last run's partial file,
  // which may hold another format.
  '--no-continue',
  '--downloader',
  'native',
  // NOTE: `--ffmpeg-location` used to live here, hard-pinned to
  // `/usr/bin/ffmpeg`. It moved OUT into the per-invocation
  // `ffmpegLocationFlags(env)` so the LIVE ingest test can point yt-dlp at a
  // self-provisioned ffmpeg (e.g. Homebrew's) discovered AFTER this array is
  // module-cached. The production default is byte-for-byte unchanged.
  // NOTE: the `youtube:player_client=…` extractor-arg moved out of BASE_FLAGS
  // into `buildAntiBotFlags` so it can be tuned per deployment (and combined
  // with a PO token / provider) via env without editing this cached set.
];

// ---------------------------------------------------------------------------
// Spawn PATH + ffmpeg location of a run on this machine — resolved from
// `process.env` on EVERY spawn so `bun dev` and the LIVE ingest test
// (`ytdlp_live.test.ts`) can name a self-provisioned toolchain (see
// `ytdlp_toolchain.ts`) AFTER this module is imported + cached. A session's
// run takes neither: its image has yt-dlp on its own PATH, and no ffmpeg.
// ---------------------------------------------------------------------------

/**
 * PATH for a yt-dlp that runs as a child of this process: the minimal set a
 * system installs into (`/usr/local/bin:/usr/bin:/bin`) — deliberately NOT
 * `process.env.PATH`, so a dev host's shell PATH can't leak arbitrary binaries
 * into the child. `VIDEO_INGEST_BIN_DIR`, when set, is PREPENDED so a
 * self-provisioned yt-dlp + deno (downloaded outside the pinned dirs, e.g. into
 * a per-user cache) is found first. Read per-spawn — never baked into a cache —
 * so the live test can set it after module load.
 */
export function buildSpawnPath(env: NodeJS.ProcessEnv): string {
  const base = '/usr/local/bin:/usr/bin:/bin';
  const extra = env.VIDEO_INGEST_BIN_DIR?.trim();
  return extra ? `${extra}:${base}` : base;
}

/**
 * `--ffmpeg-location` for a yt-dlp that runs on this machine. A run converts
 * nothing, so yt-dlp starts no ffmpeg of its own accord; the flag only says
 * where one is for a stream its own downloader hands on to ffmpeg, which a
 * session's run, with no ffmpeg, cannot fetch. Passed EXPLICITLY rather than
 * resolved via PATH, so it works even when ffmpeg lives outside the pinned
 * spawn PATH — e.g. Homebrew's `/opt/homebrew/bin/ffmpeg` on a dev laptop.
 * Defaults to `/usr/bin/ffmpeg`; `VIDEO_INGEST_FFMPEG_LOCATION` overrides with
 * an absolute path. Built per-invocation (NOT in the cached `BASE_FLAGS`) so
 * the live test can point it at a self-provisioned ffmpeg after module load.
 */
export function ffmpegLocationFlags(env: NodeJS.ProcessEnv): string[] {
  return [
    '--ffmpeg-location',
    env.VIDEO_INGEST_FFMPEG_LOCATION?.trim() || '/usr/bin/ffmpeg',
  ];
}

// Flags whose support depends on the installed yt-dlp version. Probed
// once via `yt-dlp --help` at first invocation and cached for the
// lifetime of the process. A deployment runs the version pinned by
// services/sandbox-runtime/Dockerfile, which has every flag and is not
// probed; this machinery is for dev hosts running an older system-installed
// yt-dlp (a place of this machine).
//
// Each entry: a probe substring that must appear in `--help` output AND
// the argv tokens to inject when present. The pair is contiguous in argv
// so we can pass them as a unit.
interface OptionalFlag {
  helpToken: string;
  argv: ReadonlyArray<string>;
  /** Used in the version-mismatch warning to point operators at the
   * minimum yt-dlp release that introduced the flag. */
  sinceVersion: string;
}

const OPTIONAL_FLAGS: ReadonlyArray<OptionalFlag> = [
  // Reserved for future version-gated yt-dlp flags. Round-1 review
  // requested a `--max-redirects` cap for SSRF redirect chains, but
  // yt-dlp has never shipped such a flag — HTTP redirect handling is
  // entirely internal. The probe machinery stays in place for when a
  // genuinely version-gated flag lands.
];

// ---------------------------------------------------------------------------
// Anti-bot-detection flags (built per invocation from deployment env)
//
// YouTube walls automated access from datacenter/server IPs with a
// "Sign in to confirm you're not a bot" challenge. Nothing here is a
// guaranteed bypass — YouTube's countermeasures are adversarial and change
// weekly — but each option makes traffic look more legitimate. In order of
// leverage: a clean egress IP (residential/ISP proxy) > a PO-token provider >
// guest cookies > client tuning. All are OPT-IN via env so the default build
// is unchanged. Flags are built as ARGV (never child env — the spawn env is
// deliberately stripped of secrets), and every credential-bearing value is
// covered by the stderr sanitizer below.
// ---------------------------------------------------------------------------

/**
 * `VIDEO_INGEST_PROXY_URL`, checked: the proxy video ingestion uses instead
 * of the deployment's outbound proxies. Any scheme yt-dlp speaks; prefer
 * `socks5h://` so DNS also resolves at the proxy. An invalid value is logged
 * (redacted) and treated as absent rather than failing ingestion outright.
 */
function videoIngestProxyOverride(env: NodeJS.ProcessEnv): string | null {
  const raw = env.VIDEO_INGEST_PROXY_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    console.warn('[ytdlp] VIDEO_INGEST_PROXY_URL is not a valid URL; ignoring');
    return null;
  }
  if (!isVideoProxyScheme(url.protocol)) {
    console.warn(
      `[ytdlp] VIDEO_INGEST_PROXY_URL scheme "${url.protocol}" is unsupported; ignoring`,
    );
    return null;
  }
  return raw;
}

/** The proxy one yt-dlp run goes out through. */
export interface YtdlpProxy {
  /** What `--proxy` is given. */
  url: string;
  /** The listed proxy the run took (video ingestion's own or an outbound
   * one), or null for `VIDEO_INGEST_PROXY_URL`. */
  pooled: RotatedProxy | null;
}

/**
 * A list of proxies a video moves along when the platform refuses it: video
 * ingestion's own (`VIDEO_INGEST_PROXY_URLS`) or the deployment's outbound
 * proxies (`OUTBOUND_PROXY_URLS`). Each has its own rotation, and its own
 * memory of where each platform last served a video.
 */
interface YtdlpProxyList {
  /** What a log line calls one of its entries. */
  readonly name: string;
  readonly rotation: ProxyRotation<RotatedProxy>;
  /**
   * The proxy each platform last served a video through, where its next
   * video starts. A platform that blocks some of the proxies' addresses
   * (YouTube refused about two thirds of a 100-address datacenter list on
   * 2026-10-28) then keeps serving its videos through one it accepts,
   * instead of each video meeting the blocked ones again in turn. Per
   * process, like the rotation, and per platform: Vimeo serving an address
   * says nothing about YouTube.
   */
  readonly serving: Map<string, RotatedProxy>;
}

const VIDEO_PROXIES: YtdlpProxyList = {
  name: 'video proxy',
  rotation: videoIngestProxyRotation,
  serving: new Map(),
};

const OUTBOUND_PROXIES: YtdlpProxyList = {
  name: 'outbound proxy',
  rotation: outboundProxyRotation,
  serving: new Map(),
};

/** The list video ingestion takes its proxies from: its own when
 * `VIDEO_INGEST_PROXY_URLS` lists any — never falling back to the outbound
 * proxies — else the outbound proxies. */
function ytdlpProxyList(env: NodeJS.ProcessEnv): YtdlpProxyList {
  return VIDEO_PROXIES.rotation.proxies(env).length > 0
    ? VIDEO_PROXIES
    : OUTBOUND_PROXIES;
}

/**
 * Every proxy a video's yt-dlp could be sent through, as its entry is
 * written: the single one video ingestion may be given, its own list, and
 * the outbound list. The platform's relay dials these and no other host
 * (`domains/video_links/proxy-relay.ts`).
 */
export function configuredYtdlpProxyUrls(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const override = videoIngestProxyOverride(env);
  return [
    ...(override === null ? [] : [override]),
    ...VIDEO_PROXIES.rotation.proxies(env).map((proxy) => proxy.url),
    ...OUTBOUND_PROXIES.rotation.proxies(env).map((proxy) => proxy.url),
  ];
}

/**
 * The proxy a video's yt-dlp runs start on — the single highest-leverage
 * mitigation: routing extraction through a residential/ISP egress moves it
 * off the deployment's flagged datacenter IP. `VIDEO_INGEST_PROXY_URL` wins
 * (the backend refuses to boot with it next to `VIDEO_INGEST_PROXY_URLS`);
 * without it `nextPooled` picks one of video ingestion's own proxies
 * (`VIDEO_INGEST_PROXY_URLS`, by default the next in turn), else one of the
 * deployment's outbound proxies (`OUTBOUND_PROXY_URLS`, by default the next
 * in turn with every other request to a website); with none, none.
 * {@link YtdlpRoute} keeps it for the video.
 */
export function ytdlpProxyFromEnv(
  env: NodeJS.ProcessEnv,
  nextPooled: () => RotatedProxy | null = () =>
    ytdlpProxyList(env).rotation.next(env),
): YtdlpProxy | null {
  const override = videoIngestProxyOverride(env);
  if (override !== null) return { url: override, pooled: null };
  const pooled = nextPooled();
  return pooled === null ? null : { url: pooled.url, pooled };
}

/**
 * What a run is told of its surroundings where they are not this process's
 * own. A yt-dlp in a sandbox session reaches a proxy and the PO-token
 * provider through the platform's relays (`relay.ts`), and finds the plugin
 * where its image carries it; one that runs beside this process is told
 * nothing here and reads the deployment's settings as they are.
 */
export interface YtdlpReach {
  /** A proxy's address as the run is given it. */
  readonly proxyUrl?: (proxy: YtdlpProxy) => string;
  /** The PO-token provider's base URL as the run reaches it; `null` for
   * none. */
  readonly potProviderUrl?: string | null;
  /** Where the run finds the PO-token plugin; `null` for nowhere. */
  readonly pluginDir?: string | null;
  /** The deployment's own cookie jar (`VIDEO_INGEST_COOKIES_FILE`) as the
   * run reads it; `null` for none. */
  readonly cookiesFile?: string | null;
}

/** `--proxy` for one run, its proxy chosen by {@link ytdlpProxyFromEnv}. */
export function proxyFlagsFromEnv(
  env: NodeJS.ProcessEnv,
  proxy: YtdlpProxy | null = ytdlpProxyFromEnv(env),
  reach: YtdlpReach = {},
): string[] {
  if (proxy === null) return [];
  return ['--proxy', reach.proxyUrl?.(proxy) ?? proxy.url];
}

/** The status a proxy answered yt-dlp's tunnel request with, when it
 * refused it (urllib3, and curl under `--impersonate`). */
const TUNNEL_STATUS_STDERR =
  /(?:tunnel connection failed:|connect tunnel failed, response)\s*(\d{3})/i;

/** yt-dlp's words for a proxy it could not reach at all, as urllib3 and curl
 * phrase them (not a bare mention, which a page's own text could carry). */
const PROXY_UNREACHABLE_STDERR =
  /\('Unable to connect to proxy'|Could not resolve proxy: /;

/**
 * Whether a failed run's stderr holds its proxy to blame, as `safeFetch`
 * does: the proxy could not be reached, or refused its credentials for the
 * tunnel (407). A tunnel refused with another status (a 502 for a
 * destination the proxy could not reach) says nothing against the proxy.
 *
 * A yt-dlp that runs in a session reaches its proxy through the platform's
 * relay (`relayed`): there a proxy that could not be used is the relay's own
 * answer to the tunnel request, a status no proxy sends
 * (`RELAY_PROXY_UNREACHABLE_STATUS`), and a refused credential is the
 * proxy's 407 passed on. A proxy that yt-dlp itself could not reach is then
 * the relay, which is the platform's own listener: a restart of it, or an
 * address it is not at, says nothing against the video's proxy.
 */
export function proxyFailedRun(stderr: string, relayed = false): boolean {
  const status = TUNNEL_STATUS_STDERR.exec(stderr)?.[1];
  if (status !== undefined) {
    return (
      status === '407' || status === String(RELAY_PROXY_UNREACHABLE_STATUS)
    );
  }
  return !relayed && PROXY_UNREACHABLE_STDERR.test(stderr);
}

/**
 * What a platform answers an address it will not serve: a bot check, a rate
 * limit, a refused request. The same video may well come through from
 * another address, so a run that ends this way through a list of proxies
 * goes on through another one (see {@link YtdlpRoute}).
 */
const TURNED_AWAY: ReadonlySet<YtDlpErrorReason> = new Set([
  'botDetection',
  'rateLimited',
  'forbidden',
]);

/**
 * The most runs one yt-dlp call makes through a list of proxies, each
 * through another one, when the platform turns them away or a proxy cannot
 * carry them. No further run starts once the video's step — its metadata
 * (the Vimeo embed fallback included), its captions or its sound — has spent
 * {@link PROXY_FAILOVER_WINDOW_MS}: with a last run's 90 s and its kill
 * grace, and the embed's own run, the metadata step stays inside the
 * watchdog's five minutes.
 */
export const MAX_PROXY_RUNS = 5;
const PROXY_FAILOVER_WINDOW_MS = 90_000;

/**
 * The proxy one video's yt-dlp runs go out through. A video keeps it for
 * every run — metadata, captions, sound — because the proxy its platform has
 * just served is the likeliest to serve it again. Within one run the address
 * matters too: YouTube signs its media for the address that asked and can
 * refuse the download from another (HTTP 403), so a proxy that gives every
 * connection a new address (a provider's rotating endpoint) cannot be relied
 * on for video.
 *
 * `VIDEO_INGEST_PROXY_URL` is a route of one proxy. Through a list of
 * proxies — video ingestion's own, else the outbound ones — a video starts on
 * the one its platform last served, else the next in turn; a run the platform
 * turns away there, or that its proxy cannot carry, moves the route on to the
 * next proxy of that list that has not failed the video (see `runYtdlp`).
 * When every one has, the video ends with the platform's reason: its own
 * list never hands it to the outbound proxies or a direct connection.
 */
export class YtdlpRoute {
  /** The listed proxies (by URL) that failed this video. */
  private readonly failed = new Set<string>();
  /** When the video's current step began: the start of its failover window. */
  private stepStartedAt: number | null = null;

  private constructor(
    private readonly platform: string,
    private readonly list: YtdlpProxyList,
    private current: YtdlpProxy | null,
  ) {}

  /** The route for one video on `platform` (the job's `sourcePlatform`). */
  static forVideo(
    platform = '',
    env: NodeJS.ProcessEnv = process.env,
  ): YtdlpRoute {
    const list = ytdlpProxyList(env);
    return new YtdlpRoute(
      platform,
      list,
      ytdlpProxyFromEnv(env, () =>
        list.rotation.next(env, Date.now(), {
          prefer: list.serving.get(platform) ?? null,
        }),
      ),
    );
  }

  /** The proxy the next run goes out through, or null for none. */
  get proxy(): YtdlpProxy | null {
    return this.current;
  }

  /** The video's next step (captions, sound) begins, with its own failover
   * window. */
  nextStep(): void {
    this.stepStartedAt = null;
  }

  /** Before a call's first run: the step's window opens with its first call,
   * and a route still on a proxy that failed the video moves on, when there
   * is another to move to. */
  beginCall(
    now: number = Date.now(),
    env: NodeJS.ProcessEnv = process.env,
  ): void {
    this.stepStartedAt ??= now;
    const pooled = this.current?.pooled;
    if (pooled && this.failed.has(pooled.url)) {
      this.moveOn('failed this video earlier', env);
    }
  }

  /** Whether the step's window still lets another run start. */
  windowOpen(now: number = Date.now()): boolean {
    return now - (this.stepStartedAt ?? now) < PROXY_FAILOVER_WINDOW_MS;
  }

  /** A run through this route succeeded. */
  served(): void {
    if (this.current?.pooled) {
      this.list.serving.set(this.platform, this.current.pooled);
    }
  }

  /**
   * Whether the address of a listed proxy explains `error`, a failed run
   * through this route: the proxy could not carry the run (passed over for a
   * while by its list's rotation, as for any request), or the platform
   * turned the address away (no longer where the platform's next video
   * starts). `relayed` says the run reached its proxy through the platform's
   * relay ({@link proxyFailedRun}).
   */
  blame(error: YtDlpError, relayed = false): boolean {
    const pooled = this.current?.pooled;
    if (!pooled) return false;
    if (proxyFailedRun(error.sanitizedStderr, relayed)) {
      this.list.rotation.setAside(pooled, 'yt-dlp could not get through');
    } else if (TURNED_AWAY.has(error.reason)) {
      if (this.list.serving.get(this.platform)?.url === pooled.url) {
        this.list.serving.delete(this.platform);
      }
    } else {
      return false;
    }
    this.failed.add(pooled.url);
    return true;
  }

  /** Move on to the next proxy of the route's list, in turn, that has not
   * failed this video, after the one it is on `failed` (logged by list entry
   * and label, never credentials); false when every proxy has. */
  moveOn(failed: string, env: NodeJS.ProcessEnv = process.env): boolean {
    const from = this.current?.pooled;
    if (!from) return false;
    this.failed.add(from.url);
    const { rotation } = this.list;
    const next = rotation.next(env, Date.now(), { skip: this.failed });
    if (next === null) return false;
    this.current = { url: next.url, pooled: next };
    const entry = (proxy: RotatedProxy): string =>
      `entry ${rotation.entry(proxy, env)} (${proxy.label})`;
    console.warn(
      `[ytdlp] ${this.list.name} ${entry(from)} ${failed}; the video goes on through ${entry(next)}`,
    );
    return true;
  }
}

/** Test seam: forget the proxy each platform last served, in every list. */
export function resetServingProxiesForTests(): void {
  VIDEO_PROXIES.serving.clear();
  OUTBOUND_PROXIES.serving.clear();
}

/** Default YouTube player clients when no PO-token provider is wired.
 * `default` is yt-dlp's own set of clients that need no PO token (tv_samsung
 * and visionos in 2026.10.26); `tv_simply` is a lightweight fallback that may
 * skip formats without a GVS token. */
const DEFAULT_YOUTUBE_PLAYER_CLIENT = 'default,tv_simply';

/**
 * When a PO-token provider is available (the bundled one, turned on, or an
 * explicit `VIDEO_INGEST_POT_PROVIDER_URL`), include `mweb` — yt-dlp's
 * PO-Token Guide TL;DR is "provider + mweb for GVS". Without `mweb` in the
 * list the provider is registered but rarely asked, and flagged datacenter
 * IPs still hit the bot wall. Operators can still override via env.
 */
const DEFAULT_YOUTUBE_PLAYER_CLIENT_WITH_POT = 'default,mweb,tv_simply';

/**
 * Whether the deployment turned on the PO-token provider it ships
 * (`VIDEO_INGEST_POT_PROVIDER=true`). Off unless it says so: the provider is
 * one more container, about 60 MiB at rest, and only a deployment whose
 * address YouTube challenges has a use for it.
 */
export function potProviderOn(env: NodeJS.ProcessEnv): boolean {
  return env.VIDEO_INGEST_POT_PROVIDER?.trim().toLowerCase() === 'true';
}

/**
 * The PO-token provider a run asks: the one the deployment names, else the
 * bundled one where it is turned on and the run has its plugin at hand
 * ({@link pluginAtHand}). Undefined when a run has none.
 */
export function potProviderUrl(
  env: NodeJS.ProcessEnv,
  hasBakedPlugin: boolean = pluginAtHand(env),
): string | undefined {
  return (
    env.VIDEO_INGEST_POT_PROVIDER_URL?.trim() ||
    (hasBakedPlugin && potProviderOn(env)
      ? DEFAULT_POT_PROVIDER_URL
      : undefined)
  );
}

/**
 * What a member is told when a platform's bot check ended a video for good.
 * YouTube's is one a deployment answers with PO tokens. Where it has no
 * source of them, the wall is the deployment's own setting to change, and
 * "try again later" would send the member round in circles: that case has a
 * reason of its own, which names who can change it.
 */
export function botWallReason(
  platform: string,
  env: NodeJS.ProcessEnv,
  hasBakedPlugin: boolean = pluginAtHand(env),
): 'botDetection' | 'poTokenProviderOff' {
  if (platform !== 'youtube') return 'botDetection';
  const hasTokens =
    potProviderUrl(env, hasBakedPlugin) !== undefined ||
    Boolean(env.VIDEO_INGEST_PO_TOKEN?.trim());
  return hasTokens ? 'botDetection' : 'poTokenProviderOff';
}

/** Values yt-dlp accepts for the `youtube:fetch_pot` extractor-arg. */
const FETCH_POT_VALUES = new Set(['never', 'auto', 'always']);

/**
 * `--extractor-args` for YouTube: the player-client list (env-tunable) plus an
 * optional manually-supplied PO token, and — separately — a PO-token provider
 * base URL (the bgutil HTTP provider). The provider is the sustainable way to
 * supply the GVS tokens that dissolve the bot wall for `mweb`/`web`/`tv_simply`
 * on a flagged IP; a manually-pinned token is video-ID-bound and short-lived,
 * so it's mainly for testing. Harmless for non-YouTube extractors (yt-dlp
 * ignores extractor-args that don't match the active extractor).
 */
/**
 * A pre-warmed session drawn from the pool for a single yt-dlp invocation: a
 * cookie jar already written to the job dir, plus optional YouTube visitor data
 * / PO token. Preferred over the env-configured equivalents when present.
 */
export interface YtdlpSession {
  cookiesFile?: string;
  visitorData?: string;
  poToken?: string;
}

export function youtubeExtractorArgsFromEnv(
  env: NodeJS.ProcessEnv,
  session?: YtdlpSession,
  hasBakedPlugin: boolean = HAS_BAKED_YTDLP_PLUGIN,
  reach: YtdlpReach = {},
): string[] {
  // Explicit env wins; otherwise the bundled provider, where the deployment
  // turned it on and the image ships its plugin. A run somewhere else is
  // told where it reaches the provider, or that it has none.
  const providerUrl =
    reach.potProviderUrl === undefined
      ? potProviderUrl(env, hasBakedPlugin)
      : (reach.potProviderUrl ?? undefined);

  const client =
    env.VIDEO_INGEST_PLAYER_CLIENT?.trim() ||
    (providerUrl
      ? DEFAULT_YOUTUBE_PLAYER_CLIENT_WITH_POT
      : DEFAULT_YOUTUBE_PLAYER_CLIENT);
  const parts = [`player_client=${client}`];
  const poToken = session?.poToken?.trim() || env.VIDEO_INGEST_PO_TOKEN?.trim();
  if (poToken) parts.push(`po_token=${poToken}`);
  const visitorData = session?.visitorData?.trim();
  if (visitorData) parts.push(`visitor_data=${visitorData}`);

  // Under yt-dlp's default `fetch_pot=auto`, a PLAYER-context PO token is only
  // requested when the client's policy marks it required/recommended — which
  // no WEBPO client does. The bot wall hits exactly that player request, so a
  // healthy provider ends up registered but never consulted (verified live on
  // a flagged datacenter IP: zero provider calls until this arg is set).
  // With a local sidecar the extra fetch is one cheap HTTP call per client →
  // default to `always` whenever a provider is wired. `VIDEO_INGEST_FETCH_POT`
  // (never|auto|always) overrides; `never` is the escape hatch if a wedged
  // provider ever stalls player requests.
  const fetchPotRaw = env.VIDEO_INGEST_FETCH_POT?.trim();
  let fetchPot = providerUrl ? 'always' : undefined;
  if (fetchPotRaw) {
    if (FETCH_POT_VALUES.has(fetchPotRaw)) {
      fetchPot = fetchPotRaw;
    } else {
      console.warn(
        `[ytdlp] VIDEO_INGEST_FETCH_POT "${fetchPotRaw}" is not one of never|auto|always; ignoring`,
      );
    }
  }
  if (fetchPot) parts.push(`fetch_pot=${fetchPot}`);
  const flags = ['--extractor-args', `youtube:${parts.join(';')}`];

  if (providerUrl) {
    if (URL.canParse(providerUrl)) {
      flags.push(
        '--extractor-args',
        `youtubepot-bgutilhttp:base_url=${providerUrl}`,
      );
    } else {
      console.warn(
        '[ytdlp] VIDEO_INGEST_POT_PROVIDER_URL is not a valid URL; ignoring',
      );
    }
  }
  return flags;
}

/**
 * `--cookies <file>` from `VIDEO_INGEST_COOKIES_FILE`. A Netscape cookie jar
 * captured from an anonymous incognito session raises the guest rate limit and
 * softens the bot wall with no account-ban risk; an authenticated jar unlocks
 * gated content but risks the account (operator's call). The path itself isn't
 * secret; the jar file lives on the operator's disk and is never read here.
 */
export function cookiesFlagsFromEnv(
  env: NodeJS.ProcessEnv,
  session?: YtdlpSession,
  reach: YtdlpReach = {},
): string[] {
  // The deployment's jar lies on this machine's disk. A run somewhere else
  // is told where its copy is, or that it has none: never this machine's
  // path, which names nothing there.
  const own =
    reach.cookiesFile === undefined
      ? env.VIDEO_INGEST_COOKIES_FILE?.trim()
      : (reach.cookiesFile ?? undefined);
  // A pooled session's freshly-written jar takes precedence over the
  // deployment's own.
  const path = session?.cookiesFile?.trim() || own;
  return path ? ['--cookies', path] : [];
}

/**
 * `--plugin-dirs <dir>` from `VIDEO_INGEST_YTDLP_PLUGIN_DIRS`. Points yt-dlp at
 * a plugins directory (where the toolchain of `bun dev` put the bgutil
 * PO-token-provider plugin) — needed because the spawn sets `HOME` to the
 * throwaway job dir, so the default `~/.config/yt-dlp/plugins` never resolves.
 * Falls back to the baked plugin dir where a run has a provider to ask: loaded
 * without one, the plugin would look for a provider on the loopback that
 * nobody runs. A run somewhere else is told where its plugin is, or that it
 * has none (`reach.pluginDir`), and the setting names nothing there.
 */
export function pluginDirFlagsFromEnv(
  env: NodeJS.ProcessEnv,
  hasBakedPlugin: boolean = HAS_BAKED_YTDLP_PLUGIN,
  reach: YtdlpReach = {},
): string[] {
  const dir =
    reach.pluginDir === undefined
      ? env.VIDEO_INGEST_YTDLP_PLUGIN_DIRS?.trim() ||
        (hasBakedPlugin && potProviderUrl(env, hasBakedPlugin) !== undefined
          ? BAKED_YTDLP_PLUGIN_DIR
          : undefined)
      : (reach.pluginDir ?? undefined);
  return dir ? ['--plugin-dirs', dir] : [];
}

/**
 * `--impersonate <target>` (e.g. `safari`) from `VIDEO_INGEST_IMPERSONATE`.
 * Matches the TLS/JA3 fingerprint to a real browser for the web clients.
 * Requires `curl_cffi` where yt-dlp runs (its standalone binary, which the
 * sandbox runtime image carries, bundles it), so it stays opt-in — an unset
 * default can never break a yt-dlp that lacks it.
 */
export function impersonateFlagsFromEnv(env: NodeJS.ProcessEnv): string[] {
  const target = env.VIDEO_INGEST_IMPERSONATE?.trim();
  return target ? ['--impersonate', target] : [];
}

/** Always-on light request pacing — keeps the per-IP request rate under
 * YouTube's guest ceiling without meaningfully slowing a single video. */
const STEALTH_FLAGS: ReadonlyArray<string> = ['--sleep-requests', '1'];

/**
 * Assemble every anti-bot flag from the environment. Order is irrelevant to
 * yt-dlp; grouped by concern for readability.
 */
export function buildAntiBotFlags(
  env: NodeJS.ProcessEnv,
  session?: YtdlpSession,
  proxy: YtdlpProxy | null = ytdlpProxyFromEnv(env),
  reach: YtdlpReach = {},
): string[] {
  return [
    ...proxyFlagsFromEnv(env, proxy, reach),
    ...pluginDirFlagsFromEnv(env, HAS_BAKED_YTDLP_PLUGIN, reach),
    ...cookiesFlagsFromEnv(env, session, reach),
    ...impersonateFlagsFromEnv(env),
    ...youtubeExtractorArgsFromEnv(env, session, HAS_BAKED_YTDLP_PLUGIN, reach),
    ...STEALTH_FLAGS,
  ];
}

/**
 * Oldest yt-dlp this lane is known to work against. Must never exceed the
 * `ARG YTDLP_VERSION` pin in `services/sandbox-runtime/Dockerfile`, the image
 * a deployment's yt-dlp runs in — the guard test in `ytdlp.test.ts` reads
 * that Dockerfile and enforces it, so the two cannot drift apart.
 *
 * The image is pinned, so a deployment always satisfies this. A dev host is
 * NOT: `buildSpawnPath` runs whatever `yt-dlp` sits on `/usr/local/bin`,
 * which is typically installed once and never touched again. Extractors are
 * the whole product here and they rot on a scale of weeks — on 2026-09-08 a
 * host stuck at 2026.03.17 got HTTP 412 from Bilibili (its API had moved to
 * signed requests) on a video the pinned 2026.07.04 fetched fine from the
 * same IP in the same minute. That failure is indistinguishable, in the UI
 * and in the row, from the platform blocking us — which is exactly the wrong
 * thing for a developer to conclude about their own stale binary. Pinned
 * images rot the same way: by 2026-10-28 YouTube answered 2026.07.04's audio
 * downloads with HTTP 403 from every network, so every video without
 * captions failed, while 2026.10.26 fetched the same audio.
 */
export const MIN_YTDLP_VERSION = '2026.10.26';

/**
 * Compare two yt-dlp versions. They are dates (`2026.07.04`), sometimes with
 * a same-day or nightly suffix (`2026.07.04.232805`); comparing the numeric
 * components pairwise orders both shapes. Returns <0, 0 or >0.
 */
export function compareYtdlpVersions(a: string, b: string): number {
  const parts = (v: string): number[] =>
    v
      .trim()
      .split('.')
      .map((n) => Number.parseInt(n, 10))
      .map((n) => (Number.isNaN(n) ? 0 : n));
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Memoized `--version` probe — see {@link warnIfYtdlpBelowFloor}. */
let versionProbeCache: Promise<void> | null = null;

/**
 * The stale-binary line, built here so a test can hold it to the dev
 * reporter's contract.
 *
 * It leads with `WARN` so it reads as one wherever it lands: a raw container
 * log has no severity column, and `classifyBackend` — which decides what the
 * dev loop shows — keys on the words `ERROR` and `WARN`. (#3293 also teaches
 * the dev loop that the backend's stderr is a warning stream, so this line
 * would surface either way; the prefix costs nothing and does not depend on
 * which lands first.)
 */
export function ytdlpVersionWarning(version: string): string {
  return (
    `WARN [ytdlp] yt-dlp ${version} on PATH is older than the ${MIN_YTDLP_VERSION} ` +
    `this image pins. Extractors break as platforms change, so failures here may not ` +
    `reproduce in production — and a stale binary reads exactly like a platform ` +
    `block. Upgrade the yt-dlp on PATH, or point VIDEO_INGEST_BIN_DIR at a current one.`
  );
}

/**
 * Lazy probe of `yt-dlp --version`, cached like the `--help` one and run
 * alongside it on the first spawn. Warns exactly once when the binary on
 * PATH predates {@link MIN_YTDLP_VERSION}.
 *
 * A warning, not a refusal: an old binary still extracts most videos, and
 * failing the lane closed would break a dev host that is merely behind. The
 * point is that the operator hears it from us instead of reading a
 * platform's error message and believing it.
 */
function warnIfYtdlpBelowFloor(): Promise<void> {
  versionProbeCache ??= new Promise<void>((resolve) => {
    const child = spawn(YTDLP_BIN, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: buildSpawnPath(process.env),
        HOME: tmpdir(),
        LANG: 'C.UTF-8',
      },
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('close', () => {
      // `--version` prints the bare version and nothing else.
      const version = out.trim().split('\n')[0]?.trim() ?? '';
      if (
        version !== '' &&
        compareYtdlpVersions(version, MIN_YTDLP_VERSION) < 0
      ) {
        console.warn(ytdlpVersionWarning(version));
      }
      resolve();
    });
    // Missing / unexecutable binary: the real spawn below surfaces
    // `binaryNotInstalled`, which says it better than a version warning.
    child.on('error', () => resolve());
  });
  return versionProbeCache;
}

/**
 * Lazy probe of `yt-dlp --help`. The result is cached for the lifetime
 * of the Node action instance — every action run after the first reuses
 * the prior probe instead of paying the spawn cost again.
 *
 * Returns the concrete argv that the version on PATH actually accepts.
 */
let supportedFlagsCache: Promise<string[]> | null = null;

function resolveSupportedFlags(): Promise<string[]> {
  if (supportedFlagsCache) return supportedFlagsCache;
  supportedFlagsCache = new Promise<string[]>((resolve) => {
    const child = spawn(YTDLP_BIN, ['--help'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        // Prepends `VIDEO_INGEST_BIN_DIR` when set (see `buildSpawnPath`) so
        // the probe hits the same yt-dlp the live test self-provisioned.
        PATH: buildSpawnPath(process.env),
        HOME: tmpdir(),
        LANG: 'C.UTF-8',
      },
    });
    let helpText = '';
    child.stdout.on('data', (d) => {
      helpText += d.toString();
    });
    child.stderr.on('data', (d) => {
      // Some versions print --help to stderr; defend against that too.
      helpText += d.toString();
    });
    const finish = () => {
      const extra: string[] = [];
      for (const opt of OPTIONAL_FLAGS) {
        if (helpText.includes(opt.helpToken)) {
          extra.push(...opt.argv);
        } else {
          console.warn(
            `[ytdlp] flag '${opt.helpToken}' not supported by the yt-dlp on PATH; ` +
              `upgrade to ≥ ${opt.sinceVersion} to enable. Falling back without it.`,
          );
        }
      }
      resolve([...BASE_FLAGS, ...extra]);
    };
    child.on('close', finish);
    child.on('error', () => {
      // ENOENT / EPERM / etc. — the real runYtdlp call below will hit
      // the same error and surface `binaryNotInstalled`. Resolve with
      // BASE_FLAGS so we don't block forever; the spawn there carries
      // the right diagnostic to the chip.
      resolve([...BASE_FLAGS]);
    });
  });
  return supportedFlagsCache;
}

/** Sanitization regex set — strip credentials + URLs + auth headers from
 * stderr before logging. yt-dlp's stderr can echo back signed URLs, cookies,
 * and proxy credentials in some failure modes. */
type Replacement = string | ((match: string) => string);
const SANITIZE_PATTERNS: ReadonlyArray<readonly [RegExp, Replacement]> = [
  [/https?:\/\/[^\s]+/g, 'https://<redacted>'],
  [/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>'],
  [/--username\s+\S+/gi, '--username <redacted>'],
  [/--password\s+\S+/gi, '--password <redacted>'],
  [/--cookies(-from-browser)?\s+\S+/gi, '--cookies <redacted>'],
  [/--proxy\s+\S+/gi, '--proxy <redacted>'],
  // Inline credentials in ANY scheme URL (socks included), e.g. a bare
  // `socks5h://user:pass@host:1080` echoed in a connection error without the
  // `--proxy` prefix (the `https?://` rule above only covers http/https).
  // Preserve scheme+host, drop `user:pass@`.
  [
    /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi,
    (m: string): string => `${m.slice(0, m.indexOf('//') + 2)}<redacted>@`,
  ],
  [/Authorization:\s*\S+/gi, 'Authorization: <redacted>'],
  // Cookie / Set-Cookie headers: yt-dlp -v dumps full cookie jars on
  // some failure paths. Strip the whole header value, not just the
  // first attribute pair.
  [/(?:Set-)?Cookie:\s*[^\r\n]+/gi, 'Cookie: <redacted>'],
  // S3-style presigned URL params; yt-dlp may print these stripped from
  // their parent URL when reporting "Got HTTP Error" lines.
  [/Signature=[^&\s]+/g, 'Signature=<redacted>'],
  [/Policy=[^&\s]+/g, 'Policy=<redacted>'],
  // YouTube + general OAuth/session token params that can appear bare
  // in error messages (no `https://` prefix to match URL pattern).
  // Preserve the key name so operators can identify the leak; redact
  // only the value.
  [
    /\b(po_token|visitor_data|cpn|pot|sig|signature|access_token|id_token|refresh_token|SAPISIDHASH|SAPISID)=[^\s&]+/gi,
    (m: string): string => `${m.split('=')[0]}=<redacted>`,
  ],
  // Standalone JWTs (header.payload.signature, three base64url segments).
  [
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    '<redacted-jwt>',
  ],
];

export function sanitizeStderr(raw: string): string {
  let out = raw;
  for (const [re, sub] of SANITIZE_PATTERNS) {
    // String.replace's overload signature accepts either a string or a
    // function; the union widening matters for the typechecker only.
    out =
      typeof sub === 'function' ? out.replace(re, sub) : out.replace(re, sub);
  }
  return out.slice(-800); // tail only — full stderr can be MB on chatty errors
}

export type YtDlpErrorReason =
  | 'privateOrAgeGated'
  | 'authRequired'
  | 'unavailable'
  | 'geoblocked'
  | 'unsupported'
  | 'transient'
  | 'botDetection'
  | 'rateLimited'
  | 'forbidden'
  | 'liveStream'
  | 'premiere'
  | 'memberOnly'
  | 'jsRuntimeMissing'
  | 'binaryNotInstalled'
  | 'timeout'
  | 'outputValidationFailed'
  | 'videoTooLarge';

export class YtDlpError extends Error {
  readonly reason: YtDlpErrorReason;
  /** Sanitized stderr tail — safe to surface in logs/DB. */
  readonly sanitizedStderr: string;

  constructor(
    reason: YtDlpErrorReason,
    message: string,
    sanitizedStderr: string,
  ) {
    super(message);
    this.name = 'YtDlpError';
    this.reason = reason;
    this.sanitizedStderr = sanitizedStderr;
  }
}

/**
 * Classify a sanitized stderr string into a structured reason code.
 * Patterns are ordered most-specific first; the first match wins.
 *
 * Boundary cases:
 *  - `botDetection` and `rateLimited` DO NOT go through the
 *    [30s, 60s, 120s] retry — caller should use long jitter or fail
 *    fast. YouTube's per-IP rate limit is minutes; short retries
 *    just trigger harder blocks.
 *  - `jsRuntimeMissing` means the place yt-dlp runs in is misconfigured
 *    (no Deno). Caller should alert loudly, not silently retry.
 *  - Anything this function cannot name falls through to `transient`,
 *    which IS retried. So every terminal HTTP shape must be named here
 *    or it burns the full [30s, 60s, 120s] ladder and tells the user
 *    "Temporary issue — try again" about a wall that will never move.
 *    That is how a Vimeo login wall (401), a deleted video (404), and
 *    Bilibili's risk control (412) each cost three retries and a lie.
 */
export function classifyYtDlpStderr(stderr: string): YtDlpErrorReason {
  const s = stderr.toLowerCase();
  // The operating system's own words for a file that passed what a process
  // may write to one (`EFBIG`): a download of no declared length ran into the
  // per-file limit of the session it ran in. yt-dlp ends with `ERROR: unable
  // to write data: [Errno 27] File too large`. That is the video's size, which
  // no retry changes, and three of them would each fetch the same bytes up to
  // the limit again.
  if (s.includes('[errno 27]') || s.includes('file too large')) {
    return 'videoTooLarge';
  }
  if (
    s.includes('sign in to confirm') ||
    s.includes("you're not a bot") ||
    s.includes('confirm you’re not a bot') ||
    // Bilibili answers risk-controlled requests with a bare 412 rather than
    // any human-readable wall text. Same meaning as the YouTube challenge:
    // the platform refused an automated caller, and retrying on our own
    // schedule only hardens it.
    s.includes('http error 412') ||
    s.includes('precondition failed')
  ) {
    return 'botDetection';
  }
  // The HTTP status, never a bare `429`: the line names the video, and an ID
  // such as Vimeo's `1042987654` would read as a rate limit, which sends the
  // video on through the other proxies instead of reporting its own wall.
  if (s.includes('http error 429') || s.includes('too many requests'))
    return 'rateLimited';
  if (
    s.includes('private video') ||
    s.includes('age-restricted') ||
    s.includes('age restricted') ||
    s.includes('sign in to confirm your age')
  ) {
    return 'privateOrAgeGated';
  }
  if (s.includes('members-only') || s.includes('join this channel')) {
    return 'memberOnly';
  }
  // Ordered ABOVE `geoblocked` on purpose: that branch matches the bare
  // substring `geo`, which is loose enough to swallow an auth message that
  // happens to carry it (a redirect URL, a region-flavoured host name).
  if (
    s.includes('http error 401') ||
    s.includes('unauthorized') ||
    // Vimeo, 2026: every anonymous client is walled behind a login. The
    // `web` client says so in prose; the `macos`/`android` ones fail
    // fetching the OAuth token that would have carried the session.
    s.includes('only works when logged-in') ||
    s.includes('oauth token')
  ) {
    return 'authRequired';
  }
  if (
    // Matched loosely ("available in your …", not "not available in your …")
    // because yt-dlp phrasings vary: e.g. "The uploader has not made this
    // video available in your country" separates "not" from "available".
    s.includes('available in your country') ||
    s.includes('available in your region') ||
    s.includes('geo')
  ) {
    return 'geoblocked';
  }
  if (
    s.includes('this live event will begin') ||
    s.includes('is_upcoming') ||
    s.includes('premieres')
  ) {
    return 'premiere';
  }
  if (s.includes('is a live event') || s.includes('is currently live')) {
    return 'liveStream';
  }
  if (s.includes('unsupported url')) return 'unsupported';
  if (s.includes('no supported javascript runtime')) return 'jsRuntimeMissing';
  if (s.includes('http error 403') || s.includes('forbidden'))
    return 'forbidden';
  if (
    s.includes('video unavailable') ||
    s.includes('has been removed') ||
    // Matched on the full `http error 404` rather than a bare `not found`:
    // the latter also appears in toolchain faults ("ffmpeg not found"),
    // which are ours to fix, not a gone video.
    s.includes('http error 404')
  ) {
    return 'unavailable';
  }
  return 'transient';
}

interface YtDlpSpawnResult {
  stdout: string;
  stderr: string;
}

/**
 * One yt-dlp call: `args` run in `place` through `route`, the video's proxy
 * (a route of its own when the caller has none). A run that fails because of
 * its outbound proxy's address — the platform turned it away, or the proxy
 * could not carry it — runs again through another proxy, at most
 * {@link MAX_PROXY_RUNS} runs, none started once the step's
 * {@link PROXY_FAILOVER_WINDOW_MS} is spent; any other failure is the video's
 * own answer, and so is the last one.
 */
async function runYtdlp(
  args: string[],
  place: YtdlpPlace,
  timeoutMs: number,
  session?: YtdlpSession,
  route: YtdlpRoute = YtdlpRoute.forVideo(),
): Promise<YtDlpSpawnResult> {
  // The flag set the place's yt-dlp accepts, and where its tools are.
  const commonFlags = await place.commonFlags();
  route.beginCall();
  for (let run = 1; ; run += 1) {
    try {
      // Anti-bot flags are rebuilt per run (cheap), for the proxy the route
      // is on, as the place reaches it. A pooled session (if provided)
      // supplies its own cookie jar + visitor data.
      const result = await place.run(
        [
          ...commonFlags,
          ...buildAntiBotFlags(process.env, session, route.proxy, place.reach),
          ...args,
        ],
        timeoutMs,
      );
      route.served();
      return result;
    } catch (error) {
      if (
        !(error instanceof YtDlpError) ||
        !route.blame(error, place.reach.proxyUrl !== undefined) ||
        run >= MAX_PROXY_RUNS ||
        !route.windowOpen() ||
        !route.moveOn(`failed (${error.reason})`)
      ) {
        throw error;
      }
    }
  }
}

/** One yt-dlp child in `jobDir`, stopped after `timeoutMs`. */
function spawnYtdlp(
  argv: string[],
  jobDir: string,
  timeoutMs: number,
): Promise<YtDlpSpawnResult> {
  return new Promise((resolve, reject) => {
    // `detached: true` puts the child in its own process group so we can
    // signal the whole group with `process.kill(-pid, ...)` on timeout.
    // Without this, what yt-dlp started itself (its JavaScript runtime, an
    // ffmpeg for a stream its downloader hands on) is orphaned when yt-dlp
    // is killed, and runs on to its natural exit.
    const proc = spawn(YTDLP_BIN, argv, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: jobDir,
      detached: true,
      // env stripped to the minimum yt-dlp needs. NEVER pass process.env:
      // the backend's secrets (SOPS_AGE_KEY, db creds, provider tokens)
      // would land in the child's environment. `buildSpawnPath` keeps the
      // pinned PATH unless `VIDEO_INGEST_BIN_DIR` is set.
      env: {
        PATH: buildSpawnPath(process.env),
        HOME: jobDir,
        LANG: 'C.UTF-8',
      },
    });
    let stdout = '';
    let stderr = '';
    // Cap accumulated output to prevent OOM on chatty errors. yt-dlp
    // normally produces <100KB of stdout (metadata JSON or single line);
    // stderr can balloon on retries.
    const MAX_BYTES = 8 * 1024 * 1024;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    // Settled-flag pattern. Without this, the timeout handler synchronously
    // calls `reject` BEFORE `close` fires; the eventual `close` then calls
    // `reject` a second time (Node silently ignores it) — but more
    // importantly, callers' `.catch` chain proceeds to `fs.readdir` /
    // cleanup while the child is still writing to `jobDir` during the
    // SIGTERM→SIGKILL grace window. Resolve/reject only after `close`.
    let settled = false;
    let timedOut = false;
    let byteCapExceeded = false;
    let sigkillTimer: NodeJS.Timeout | undefined;
    // Group-targeted kill: `-pid` (negative, leading-minus) signals the
    // whole process group. yt-dlp spawns ffmpeg as a child; without the
    // group target, our `proc.kill` reaches yt-dlp only and ffmpeg
    // continues converting until natural exit. The fall-back `proc.kill`
    // handles edge cases where setpgid hasn't run yet (very early
    // failures) — same signal, narrower target.
    const killGroup = (signal: NodeJS.Signals): void => {
      const pid = proc.pid;
      if (pid === undefined) return;
      try {
        process.kill(-pid, signal);
      } catch {
        try {
          proc.kill(signal);
        } catch (err) {
          // ESRCH is the child already gone; anything else (EPERM) means
          // the signal never landed and an ffmpeg may be orphaned.
          const code =
            err instanceof Error && 'code' in err ? err.code : undefined;
          if (code !== 'ESRCH') {
            console.warn(
              `[ytdlp] ${signal} fallback failed for pid ${pid}:`,
              err instanceof Error ? err.message : String(err),
            );
          }
        }
      }
    };
    const killEscalate = (): void => {
      killGroup('SIGTERM');
      sigkillTimer = setTimeout(() => killGroup('SIGKILL'), 5_000);
    };

    // SIGTERM → SIGKILL escalation. Gives yt-dlp + its ffmpeg child a 5s
    // window to flush partial files, close sockets, and exit cleanly
    // before we hard-kill the process group. Without the grace period
    // ffmpeg can be orphaned mid-write and leave .part files behind
    // (R2 review M-yt-dlp). Reject is deferred to the `close` handler
    // below so streams have a chance to drain — otherwise the caller's
    // `.catch` races jobDir cleanup against still-writing ffmpeg
    // children.
    const killer = setTimeout(() => {
      timedOut = true;
      killEscalate();
    }, timeoutMs);

    const settleReject = (err: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      reject(err);
    };
    const settleResolve = (val: YtDlpSpawnResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      resolve(val);
    };

    proc.stdout.on('data', (d) => {
      stdoutBytes += d.length;
      if (stdoutBytes < MAX_BYTES) stdout += d.toString();
      else if (!byteCapExceeded) {
        // Once the cap is hit, terminate the child — letting it keep
        // streaming wastes CPU/IO and a hostile output (huge JSON dump,
        // chatty stderr retry loop) can hold the action hostage for the
        // full wall-clock budget.
        byteCapExceeded = true;
        killEscalate();
      }
    });
    proc.stderr.on('data', (d) => {
      stderrBytes += d.length;
      if (stderrBytes < MAX_BYTES) stderr += d.toString();
      else if (!byteCapExceeded) {
        byteCapExceeded = true;
        killEscalate();
      }
    });

    proc.on('error', (err) => {
      // ENOENT means the yt-dlp binary isn't on $PATH — the container
      // was started from an image built before the Dockerfile yt-dlp
      // install landed. Surface as a NEVER_RETRY reason so the chip
      // flips to failed immediately with a clear message, instead of
      // burning 3 retry cycles with opaque "transient" errors.
      // Third-party-gap cast: Node's `'error'` event typings declare
      // `Error` but the runtime always populates `.code` for spawn
      // failures — `NodeJS.ErrnoException` is the lib.d.ts shape.
      const errno = (err as NodeJS.ErrnoException).code;
      if (errno === 'ENOENT') {
        settleReject(
          new YtDlpError(
            'binaryNotInstalled',
            'yt-dlp is not on PATH: install it, or point VIDEO_INGEST_BIN_DIR at one',
            '',
          ),
        );
        return;
      }
      settleReject(err);
    });
    proc.on('close', (code) => {
      try {
        settleResolve(
          ytdlpRunOutcome({
            code,
            stdout,
            stderr,
            timedOut,
            outputCapped: byteCapExceeded,
            timeoutMs,
            outputCapBytes: MAX_BYTES,
          }),
        );
      } catch (error) {
        settleReject(error);
      }
    });
  });
}

/** How one yt-dlp run ended, wherever it ran. */
export interface YtdlpRunEnd {
  /** Its exit code; `null` for a run a signal ended. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** It was stopped at its time limit. */
  readonly timedOut: boolean;
  /** It was stopped, or its output cut, at the output cap. */
  readonly outputCapped: boolean;
  readonly timeoutMs: number;
  readonly outputCapBytes: number;
}

/**
 * What a finished run comes to: its output, or the {@link YtDlpError} its
 * end means. One judgment for every place a run happens, so that a video
 * fails for the same reason wherever its yt-dlp ran: a timeout, output past
 * its cap, and otherwise what stderr says of an exit that is not 0. stderr
 * is sanitized before it is kept or classified.
 */
export function ytdlpRunOutcome(end: YtdlpRunEnd): YtDlpSpawnResult {
  const sanitized = sanitizeStderr(end.stderr);
  if (end.timedOut) {
    throw new YtDlpError(
      'timeout',
      `yt-dlp timed out after ${end.timeoutMs}ms`,
      sanitized,
    );
  }
  if (end.outputCapped) {
    throw new YtDlpError(
      'transient',
      `yt-dlp output exceeded ${end.outputCapBytes} bytes (cap-killed)`,
      sanitized,
    );
  }
  if (end.code !== 0) {
    const reason = classifyYtDlpStderr(sanitized);
    throw new YtDlpError(
      reason,
      `yt-dlp exited ${end.code} (reason: ${reason})`,
      sanitized,
    );
  }
  return { stdout: end.stdout, stderr: end.stderr };
}

/** A file of a place's directory as a listing names it. */
export interface YtdlpEntry {
  readonly name: string;
  readonly size: number;
}

/** A file a place hands on as it is read: its bytes, and how many they
 * are. Whoever takes it reads the body to its end or cancels it. */
export interface YtdlpFile {
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number;
}

/**
 * Where one video's yt-dlp runs, and where its files are: a sandbox session
 * (`session_place.ts`), which is how a deployment runs it, or a directory of
 * this machine with yt-dlp as a child of this process
 * ({@link createLocalYtdlpPlace}), which is how a developer's own machine and
 * the tests do. The three calls below are the same in both: what differs is
 * who starts the process and who holds the files.
 */
export interface YtdlpPlace {
  /** The directory yt-dlp works in, as it is named to yt-dlp. */
  readonly dir: string;
  /** What a run here is told of its surroundings. */
  readonly reach: YtdlpReach;
  /** The flags every run here begins with: the set the place's yt-dlp
   * accepts, and where its tools are. */
  commonFlags(): Promise<string[]>;
  /** One yt-dlp, stopped after `timeoutMs`. Fails with a {@link YtDlpError}
   * as {@link spawnYtdlp} does: for a timeout, for output past its cap, for
   * a binary that is not there, and for an exit that is not 0, by what its
   * stderr says. */
  run(argv: string[], timeoutMs: number): Promise<YtDlpSpawnResult>;
  /** The files in the directory, each with its size. */
  list(): Promise<YtdlpEntry[]>;
  /** A small file of the directory, whole. */
  readFile(name: string, maxBytes: number): Promise<Uint8Array>;
  /** A file of the directory as a stream of a known length, for a reader
   * that passes it on and holds none of it. */
  openFile(name: string, maxBytes: number): Promise<YtdlpFile>;
  /** Write a small text file that only its owner reads, and answer its
   * path as yt-dlp is given it. */
  writeFile(name: string, content: string): Promise<string>;
  /** The place is done with: its directory, or its session, goes. */
  dispose(): Promise<void>;
}

export type { YtDlpSpawnResult };

/** A file of a place by a name that names nothing but itself: one path
 * segment, of the characters `--restrict-filenames` leaves. Mitigates the
 * path-traversal class of CVE-2024-38519: even if yt-dlp's own sanitizer is
 * bypassed, nothing is read that a name could lead out to. */
export function isPlainOutputName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(name);
}

function tooLarge(name: string, maxBytes: number): YtDlpError {
  return new YtDlpError(
    'outputValidationFailed',
    `yt-dlp left ${name} larger than the ${maxBytes} bytes it may be`,
    '',
  );
}

/**
 * yt-dlp as a child of this process, in `dir`. `dispose` is what removes the
 * directory, for a caller that made it.
 */
export function localYtdlpPlace(
  dir: string,
  dispose: () => Promise<void> = () => Promise.resolve(),
): YtdlpPlace {
  /** The real path of `name`, which must lie in the directory itself. */
  const inside = async (name: string): Promise<string> => {
    if (!isPlainOutputName(name)) {
      throw new YtDlpError(
        'outputValidationFailed',
        `yt-dlp left a file under a name it was not told to write: ${name.slice(0, 80)}`,
        '',
      );
    }
    const realDir = await fs.realpath(dir);
    const real = await fs.realpath(resolvePath(dir, name));
    if (!real.startsWith(`${realDir}/`)) {
      throw new YtDlpError(
        'outputValidationFailed',
        `yt-dlp wrote outside its directory: ${real}`,
        '',
      );
    }
    return real;
  };
  const sized = async (name: string, maxBytes: number) => {
    const file = await inside(name);
    const { size } = await fs.stat(file);
    if (size > maxBytes) throw tooLarge(name, maxBytes);
    return { file, size };
  };
  return {
    dir,
    reach: {},
    commonFlags: async () => {
      // The flag set the yt-dlp on PATH accepts: probed with `--help` on
      // the first call and kept. `ffmpegLocationFlags` is read from the
      // environment each time, so a test's own toolchain takes effect after
      // this module is loaded.
      const flags = await resolveSupportedFlags();
      await warnIfYtdlpBelowFloor();
      return [...flags, ...ffmpegLocationFlags(process.env)];
    },
    run: (argv, timeoutMs) => spawnYtdlp(argv, dir, timeoutMs),
    list: async () => {
      const entries: YtdlpEntry[] = [];
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        // Files alone, and never what a link points at.
        if (!entry.isFile()) continue;
        const { size } = await fs.lstat(join(dir, entry.name));
        entries.push({ name: entry.name, size });
      }
      return entries;
    },
    readFile: async (name, maxBytes) =>
      await fs.readFile((await sized(name, maxBytes)).file),
    openFile: async (name, maxBytes) => {
      const { file, size } = await sized(name, maxBytes);
      return { body: fileBody(file), size };
    },
    writeFile: async (name, content) => {
      const file = join(dir, name);
      await fs.writeFile(file, content, { mode: 0o600 });
      return file;
    },
    dispose,
  };
}

/**
 * A place of this machine in a directory of its own, removed when the place
 * is disposed of.
 */
export async function createLocalYtdlpPlace(): Promise<YtdlpPlace> {
  const dir = join(tmpdir(), `vlink-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  return localYtdlpPlace(dir, async () => {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      // Non-fatal: the directory may be gone already. Logged for whoever
      // finds one left behind.
      console.warn(
        `[video_links/ytdlp] failed to cleanup ${dir}:`,
        err instanceof Error ? err.message : err,
      );
    }
  });
}

/**
 * yt-dlp metadata fetch. Returns parsed JSON `info_dict`. No download.
 *
 * Phase A of the orchestrator — typical wall-clock <2s; 90s timeout is
 * a generous ceiling.
 */
export interface YtDlpMetadata {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  language?: string;
  is_live?: boolean;
  live_status?: string;
  availability?: string;
  thumbnail?: string;
  chapters?: Array<{ start_time: number; end_time: number; title: string }>;
  subtitles?: Record<
    string,
    Array<{ ext?: string; url?: string; name?: string }>
  >;
  automatic_captions?: Record<
    string,
    Array<{ ext?: string; url?: string; name?: string; protocol?: string }>
  >;
}

function isYtDlpMetadata(value: unknown): value is YtDlpMetadata {
  return typeof value === 'object' && value !== null;
}

export async function ytdlpJson(
  url: string,
  place: YtdlpPlace,
  timeoutMs = 90_000,
  session?: YtdlpSession,
  route?: YtdlpRoute,
): Promise<YtDlpMetadata> {
  const { stdout } = await runYtdlp(
    ['-J', '--', url],
    place,
    timeoutMs,
    session,
    route,
  );
  // `-J` produces a single JSON object on stdout. For non-playlist URLs
  // we asked for, it's the video info_dict directly.
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new YtDlpError(
      'transient',
      `yt-dlp produced unparseable metadata JSON`,
      err instanceof Error ? err.message.slice(0, 200) : '',
    );
  }
  if (!isYtDlpMetadata(parsed)) {
    throw new YtDlpError(
      'transient',
      `yt-dlp metadata is not a JSON object`,
      '',
    );
  }
  return parsed;
}

/** The caption formats the platform reads: WebVTT, and SubRip, which is
 * WebVTT but for its header and the comma in its timestamps
 * (`captions_parser.ts`). */
export type CaptionFormat = 'vtt' | 'srt';

/** A caption track yt-dlp wrote, by its file's name in the place. */
export interface YtdlpCaptionFile {
  readonly name: string;
  readonly format: CaptionFormat;
}

/** The most a caption file may weigh. yt-dlp is told the same
 * (`--max-filesize 5M`); this is what a reader of the file holds to. 5 MiB
 * is well past any legitimate transcript (about eight hours of
 * auto-generated captions at a cue a second). */
export const CAPTIONS_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Fetch a subtitle track as the platform serves it, in WebVTT where it has
 * that (YouTube, Vimeo and Dailymotion do) and else in SubRip. Returns the
 * file yt-dlp wrote, or null if it wrote none in a format the platform
 * reads.
 *
 * Nothing is converted here. yt-dlp converts a track with ffmpeg, and a run
 * has none: it happens in a sandbox session, whose image carries no ffmpeg
 * (tale-project/tale#4942). A platform that serves a track in neither
 * format has no captions as far as this lane goes, and its video is
 * transcribed from its sound.
 *
 * Phase B of the orchestrator. `lang` should be a yt-dlp lang spec
 * (e.g. `en`, `en.*`, `zh-Hans`, or `en-orig` for the source-language
 * track when present).
 */
// Lang token shape: BCP-47-ish identifier (`en`, `zh-Hans`, `pt-BR`,
// `en-orig`) plus the `-suffix` variants yt-dlp uses for original / ASR
// tracks. Strict allow-list keeps attacker-controlled metadata keys
// (`Object.keys(meta.subtitles)`) from injecting commas/regex tokens
// into the `--sub-langs` value below — yt-dlp parses that as a comma-
// separated list with regex tokens, so an attacker-supplied key like
// `en,-danmaku,evil-track` could broaden the selection. Defense-in-depth:
// `selectCaptionLanguage` only picks from known yt-dlp metadata, but a
// future code change loosening that step shouldn't open a hole here.
const LANG_TOKEN_RE = /^[A-Za-z0-9_.-]{1,32}$/;

export async function ytdlpWriteSubs(
  url: string,
  lang: string,
  place: YtdlpPlace,
  opts: {
    /** If true, include `--write-auto-subs` for ASR auto-generated tracks
     * (used when no manual track in the desired language exists). */
    includeAutoGenerated?: boolean;
    timeoutMs?: number;
    session?: YtdlpSession;
    route?: YtdlpRoute;
  } = {},
): Promise<YtdlpCaptionFile | null> {
  if (!LANG_TOKEN_RE.test(lang)) {
    throw new YtDlpError(
      'unsupported',
      `Refusing to fetch subs: lang token "${lang.slice(0, 20)}" failed allow-list`,
      '',
    );
  }
  const args = [
    '--write-subs',
    ...(opts.includeAutoGenerated ? ['--write-auto-subs'] : []),
    '--sub-format',
    // WebVTT first, SubRip else, and nothing else: json3, srv3 and TTML
    // would need a conversion no run has the tool for.
    'vtt/srt',
    '--sub-langs',
    // Exclude Bilibili-style noise + AI-translated tracks unless explicitly
    // asked for the auto-gen fallback.
    `${lang},-danmaku${opts.includeAutoGenerated ? '' : ',-ai-.*'}`,
    '--skip-download',
    // Hard cap on the on-disk subtitle file. yt-dlp will refuse to write
    // a track bigger than this — defends against a hostile uploader
    // hosting a multi-GB track that would exhaust both the download step
    // and the in-memory parse step.
    '--max-filesize',
    '5M',
    '--paths',
    `home:${place.dir}`,
    '--paths',
    `temp:${place.dir}`,
    // A name of ours, never one derived from the video's metadata.
    '-o',
    'subs.%(ext)s',
    // `--` separator: defense-in-depth against URL-starting-with-dash
    // being reinterpreted as a flag. `assertSafeUrl` already requires
    // `https:` so this is currently unreachable, but loosening URL
    // validation later won't accidentally break this argv shape.
    '--',
    url,
  ];
  await runYtdlp(
    args,
    place,
    opts.timeoutMs ?? 90_000,
    opts.session,
    opts.route,
  );

  // yt-dlp names a track after the template and the language it wrote:
  // `subs.<lang>.vtt`.
  const written = (await place.list())
    .map((entry) => entry.name)
    .filter(
      (entry) =>
        isPlainOutputName(entry) && /^subs\..+\.(?:vtt|srt)$/.test(entry),
    );
  const name =
    written.find((entry) => entry.endsWith('.vtt')) ??
    written.find((entry) => entry.endsWith('.srt'));
  if (name === undefined) return null;
  return { name, format: name.endsWith('.vtt') ? 'vtt' : 'srt' };
}

/**
 * The files a video's sound may arrive in, by their extension, and what
 * each is stored as: the containers video platforms serve sound in, alone or
 * with a picture. What yt-dlp writes under another extension is not taken
 * for sound.
 */
const MEDIA_TYPES: ReadonlyMap<string, string> = new Map([
  ['webm', 'audio/webm'],
  ['weba', 'audio/webm'],
  ['m4a', 'audio/mp4'],
  ['mp4', 'video/mp4'],
  ['mp3', 'audio/mpeg'],
  ['ogg', 'audio/ogg'],
  ['oga', 'audio/ogg'],
  ['opus', 'audio/ogg'],
  ['aac', 'audio/aac'],
  ['flac', 'audio/flac'],
  ['wav', 'audio/wav'],
  ['mka', 'audio/x-matroska'],
  ['mkv', 'video/x-matroska'],
  ['mov', 'video/quicktime'],
  ['flv', 'video/x-flv'],
  ['ts', 'video/mp2t'],
  ['3gp', 'video/3gpp'],
]);

/** A video's sound as yt-dlp fetched it, by its file's name in the place. */
export interface YtdlpMediaFile {
  readonly name: string;
  /** The file's extension, which the stored file keeps. */
  readonly extension: string;
  readonly contentType: string;
  /** How many bytes yt-dlp left of it. */
  readonly size: number;
}

/**
 * The most a video's sound may weigh: 1 GiB, which four hours (the longest
 * video the lane takes) come to at close to 600 kbps. Sound alone is a
 * quarter of that at most; the room is for a platform that serves sound
 * only with a picture, whose smallest one is taken.
 *
 * A video's session is created with this as the size one file may be
 * (`maxFileBytes`, `session_place.ts`): a `default` session's own is 100 MiB,
 * which two hours of sound pass on a platform that serves fragments of no
 * declared length (Vimeo, Dailymotion, Twitch), where yt-dlp's
 * `--max-filesize` stops nothing. Whatever is larger is the video's own
 * answer, `videoTooLarge`, and is not retried.
 */
export const MEDIA_MAX_BYTES = 1024 * 1024 * 1024;

/** {@link MEDIA_MAX_BYTES} as yt-dlp is told it, with room for a stream
 * whose length the platform understates (yt-dlp's `M` is a mebibyte). */
const MEDIA_MAX_FILESIZE = '1000M';

/**
 * What the sound should weigh at most where a platform leaves the choice:
 * 200 MiB, which is four hours at about 115 kbps. Every stream is re-encoded to
 * 32 kbps before a model hears it (`audio_preprocess.ts`), so a larger one
 * buys nothing and is carried through the session, the spawner and the
 * object store all the same.
 */
const MEDIA_PREFERRED_SIZE = '200M';

/**
 * Which stream of a video its sound is taken from: the streams yt-dlp is
 * asked for, in the order it tries them, and how it tells the streams of a
 * kind apart.
 *
 * `bestaudio` is a stream of sound alone, which the large platforms serve.
 * A platform that serves sound only with a picture is asked for a small
 * picture, which the transcription lane drops: one of at most 480 pixels in
 * height, or in width, which is the side an upright picture is small on. A
 * portrait clip's renditions run 360x640, 480x848, 720x1280 and 1080x1920;
 * asked by height alone, a minute of one came at its full 36 MB, and a
 * minute of one that is served at 20 Mbit/s too at 147 MB (measured against
 * Dailymotion, 2026-11-22). Where no picture is that small, or none says
 * its size, a stream of a modest bitrate is asked for, and whatever the
 * platform has where it has none of those.
 *
 * `-S`: among the streams of a kind, the largest that stays under the
 * preferred size, and the smallest there is where none does: by its
 * declared size, else by its bitrate and the video's length. `lang` comes
 * first, as it does in yt-dlp's own order: sorted by size alone, a dubbed
 * track that happens to weigh more is taken for the original.
 *
 * What yt-dlp makes of it is yt-dlp's to say: `ytdlp_live.test.ts` asks the
 * real one, offline, for ladders of each shape.
 */
export const MEDIA_SELECTION: readonly string[] = [
  '-f',
  [
    'bestaudio',
    'best[height<=480]',
    'best[width<=480]',
    'best[tbr<=1000]',
    'best[tbr<=2500]',
    'best',
  ].join('/'),
  '-S',
  `lang,size:${MEDIA_PREFERRED_SIZE}`,
];

/** yt-dlp's words for a download it did not start because the platform
 * declared more than `--max-filesize`. It exits 0 all the same. */
const OVER_MAX_FILESIZE_STDOUT = /File is larger than max-filesize/;

function videoTooLarge(detail: string, stderr = ''): YtDlpError {
  return new YtDlpError(
    'videoTooLarge',
    `the video's sound is larger than the ${MEDIA_MAX_BYTES} bytes it may be: ${detail}`,
    stderr,
  );
}

/**
 * Download a video's sound as the platform serves it, and do nothing to it.
 *
 * Phase C of the orchestrator — wall-clock 15min covers most 4h videos
 * on a reasonable network.
 *
 * yt-dlp used to extract the sound to an `.mp3` with ffmpeg here. That was
 * a conversion nothing needed: `audio_preprocess.ts` re-encodes whatever it
 * is given to 32 kbps Opus before a model hears it, as it does an uploaded
 * video, and an `.mp3` at the best quality weighs more than the stream it
 * came from. Now the stream is stored as it is and converted once, by the
 * transcription lane, and a run needs no ffmpeg (tale-project/tale#4942).
 *
 * Which of a video's streams that is: {@link MEDIA_SELECTION}.
 */
export async function ytdlpFetchAudio(
  url: string,
  place: YtdlpPlace,
  timeoutMs = 15 * 60_000,
  session?: YtdlpSession,
  route?: YtdlpRoute,
): Promise<YtdlpMediaFile> {
  const args = [
    ...MEDIA_SELECTION,
    // No fix-up of a container after the download: that is ffmpeg's work,
    // and whatever would be fixed, ffmpeg reads as it is later.
    '--fixup',
    'never',
    // Stops a stream of a declared length before its first byte. One served
    // in fragments declares none: that one ends at the session's per-file
    // limit, or is measured below once it is there.
    '--max-filesize',
    MEDIA_MAX_FILESIZE,
    '--paths',
    `home:${place.dir}`,
    '--paths',
    `temp:${place.dir}`,
    // A name of ours, never one derived from the video's metadata.
    '-o',
    'media.%(ext)s',
    // `--` separator: defense-in-depth (see ytdlpWriteSubs comment).
    '--',
    url,
  ];
  const { stdout } = await runYtdlp(args, place, timeoutMs, session, route);

  for (const entry of await place.list()) {
    const extension = /^media\.([a-z0-9]{1,5})$/.exec(entry.name)?.[1];
    const contentType =
      extension === undefined ? undefined : MEDIA_TYPES.get(extension);
    if (extension === undefined || contentType === undefined) continue;
    // Where nothing stopped the download (a place of this machine, a
    // Kubernetes session, which has no per-file limit), the file says so.
    if (entry.size > MEDIA_MAX_BYTES) {
      throw videoTooLarge(`yt-dlp left ${entry.size} bytes of it`);
    }
    return { name: entry.name, extension, contentType, size: entry.size };
  }
  // A stream that declares more than the size limit is not started, and
  // yt-dlp still exits 0.
  if (OVER_MAX_FILESIZE_STDOUT.test(stdout)) {
    throw videoTooLarge('the platform declares more');
  }
  throw new YtDlpError(
    'outputValidationFailed',
    'yt-dlp left no sound it was asked for: none in a container this lane takes',
    '',
  );
}
