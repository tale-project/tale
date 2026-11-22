import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyBackend } from '@tale/shared/classify';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  nextOutboundProxy,
  resetOutboundProxiesForTests,
} from '../../../lib/net/outbound-proxy';
import { resetVideoIngestProxiesForTests } from '../../../lib/net/video-ingest-proxies';
import {
  buildAntiBotFlags,
  buildSpawnPath,
  classifyYtDlpStderr,
  compareYtdlpVersions,
  MAX_PROXY_RUNS,
  MIN_YTDLP_VERSION,
  cookiesFlagsFromEnv,
  ffmpegLocationFlags,
  impersonateFlagsFromEnv,
  pluginDirFlagsFromEnv,
  potProviderOn,
  potProviderUrl,
  botWallReason,
  proxyFlagsFromEnv,
  sanitizeStderr,
  youtubeExtractorArgsFromEnv,
  configuredYtdlpProxyUrls,
  proxyFailedRun,
  resetServingProxiesForTests,
  YtDlpError,
  ytdlpFetchAudio,
  ytdlpJson,
  ytdlpRunOutcome,
  localYtdlpPlace,
  createLocalYtdlpPlace,
  isPlainOutputName,
  CAPTIONS_MAX_BYTES,
  MEDIA_MAX_BYTES,
  type YtdlpRunEnd,
  ytdlpProxyFromEnv,
  YtdlpRoute,
  ytdlpVersionWarning,
  ytdlpWriteSubs,
} from './ytdlp';
import {
  BGUTIL_PLUGIN_NEST_DIR,
  bgutilPluginInstallDir,
} from './ytdlp_toolchain';

describe('classifyYtDlpStderr', () => {
  // What yt-dlp 2026.10.26 ends with when the file it downloads passes the
  // per-file limit of the session it runs in (measured under `ulimit -f`):
  // a download of no declared length, which `--max-filesize` cannot stop.
  it("names a download that ran into the per-file limit as the video's size", () => {
    expect(
      classifyYtDlpStderr(
        'ERROR: unable to write data: [Errno 27] File too large',
      ),
    ).toBe('videoTooLarge');
    // The operating system's words win over whatever else the tail holds.
    expect(
      classifyYtDlpStderr(
        'WARNING: [youtube] HTTP Error 429: Too Many Requests. Retrying\nERROR: unable to write data: [Errno 27] File too large',
      ),
    ).toBe('videoTooLarge');
  });

  it('classifies the YouTube bot wall', () => {
    expect(
      classifyYtDlpStderr(
        "ERROR: [youtube] xyz: Sign in to confirm you're not a bot",
      ),
    ).toBe('botDetection');
    expect(
      classifyYtDlpStderr('Please confirm you’re not a bot to continue'),
    ).toBe('botDetection');
  });

  it('classifies rate limiting and forbidden separately', () => {
    expect(classifyYtDlpStderr('HTTP Error 429: Too Many Requests')).toBe(
      'rateLimited',
    );
    expect(classifyYtDlpStderr('HTTP Error 403: Forbidden')).toBe('forbidden');
  });

  it('classifies common terminal states', () => {
    expect(classifyYtDlpStderr('ERROR: Private video')).toBe(
      'privateOrAgeGated',
    );
    expect(classifyYtDlpStderr('Video unavailable')).toBe('unavailable');
    expect(classifyYtDlpStderr('ERROR: Unsupported URL: https://x')).toBe(
      'unsupported',
    );
  });

  it('classifies geo-blocks across yt-dlp phrasings', () => {
    // Verbatim stderr from a real CH/LI-restricted video: "not" and
    // "available" are non-contiguous here, which the old pattern missed.
    expect(
      classifyYtDlpStderr(
        'ERROR: [youtube] h7LDFVd8DSk: The uploader has not made this video available in your country\n' +
          'This video is available in Switzerland, Liechtenstein.\n' +
          'You might want to use a VPN or a proxy server (with --proxy) to workaround.\n',
      ),
    ).toBe('geoblocked');
    expect(
      classifyYtDlpStderr('ERROR: This video is not available in your country'),
    ).toBe('geoblocked');
    expect(
      classifyYtDlpStderr('The video is not available in your region'),
    ).toBe('geoblocked');
  });

  // Verbatim stderr captured on 2026-09-08 against yt-dlp 2026.03.17 /
  // 2026.07.04 / 2026.08.19. Every one of these used to fall through to
  // `transient`, so each cost the full [30s, 60s, 120s] ladder and told the
  // user "Temporary issue — try again" about a wall that never moves.
  it('classifies a platform login wall as terminal, not transient', () => {
    expect(
      classifyYtDlpStderr(
        'ERROR: [vimeo] 1206142064: Failed to fetch macos OAuth token: HTTP Error 401: Unauthorized (caused by <HTTPError 401: Unauthorized>)',
      ),
    ).toBe('authRequired');
    expect(
      classifyYtDlpStderr(
        'ERROR: [vimeo] 1206142064: The web client only works when logged-in. Use --cookies, --cookies-from-browser, --username and --password, --netrc-cmd, or --netrc (vimeo) to provide account credentials.',
      ),
    ).toBe('authRequired');
    expect(
      classifyYtDlpStderr(
        'ERROR: [vimeo] 1206142064: The android client is unable to fetch new OAuth tokens and is only intended for use with previously cached tokens',
      ),
    ).toBe('authRequired');
  });

  it('keeps the bot wall ahead of the login wall', () => {
    // "Sign in to confirm you're not a bot" is an auth-shaped sentence about
    // a bot challenge. It must stay `botDetection` — that reason drives the
    // pooled-session 'blocked' report, which `authRequired` must not.
    expect(
      classifyYtDlpStderr(
        "ERROR: [youtube] xyz: Sign in to confirm you're not a bot. HTTP Error 401: Unauthorized",
      ),
    ).toBe('botDetection');
  });

  it("classifies Bilibili's bare 412 risk control as a block", () => {
    expect(
      classifyYtDlpStderr(
        'ERROR: [BiliBili] 18M7k6UE7d: Unable to download JSON metadata: HTTP Error 412: Precondition Failed (caused by <HTTPError 412: Precondition Failed>)',
      ),
    ).toBe('botDetection');
  });

  it('classifies a 404 as a gone video, but leaves toolchain faults alone', () => {
    expect(
      classifyYtDlpStderr(
        'ERROR: [vimeo] 999999999999: Unable to download webpage: HTTP Error 404: Not Found (caused by <HTTPError 404: Not Found>)',
      ),
    ).toBe('unavailable');
    // A bare "not found" is ours to fix, not a gone video — it must NOT
    // borrow the terminal reason and hide a broken image from the operator.
    expect(classifyYtDlpStderr('ERROR: ffmpeg not found')).toBe('transient');
  });

  it('reads a 429 in the video ID as nothing', () => {
    expect(
      classifyYtDlpStderr(
        'ERROR: [vimeo] 1042987654: The web client only works when logged-in. Use --cookies, --cookies-from-browser, --username and --password, --netrc-cmd, or --netrc (vimeo) to provide account credentials.',
      ),
    ).toBe('authRequired');
    expect(
      classifyYtDlpStderr('ERROR: [youtube] x429yz0AbCd: Private video'),
    ).toBe('privateOrAgeGated');
  });

  it('falls back to transient for anything unrecognized', () => {
    expect(classifyYtDlpStderr('some unexpected network blip')).toBe(
      'transient',
    );
  });
});

describe('proxyFlagsFromEnv', () => {
  it('is empty when unset', () => {
    expect(proxyFlagsFromEnv({})).toEqual([]);
  });

  it('passes a valid socks5h proxy through', () => {
    const url = 'socks5h://user:pass@residential.example:1080';
    expect(proxyFlagsFromEnv({ VIDEO_INGEST_PROXY_URL: url })).toEqual([
      '--proxy',
      url,
    ]);
  });

  it('accepts http/https/socks schemes', () => {
    for (const url of [
      'http://p:1',
      'https://p:1',
      'socks4://p:1',
      'socks5://p:1',
    ]) {
      expect(proxyFlagsFromEnv({ VIDEO_INGEST_PROXY_URL: url })).toEqual([
        '--proxy',
        url,
      ]);
    }
  });

  it('rejects unsupported schemes and garbage (logged, not thrown)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(proxyFlagsFromEnv({ VIDEO_INGEST_PROXY_URL: 'ftp://p:1' })).toEqual(
      [],
    );
    expect(proxyFlagsFromEnv({ VIDEO_INGEST_PROXY_URL: 'not a url' })).toEqual(
      [],
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('ytdlpProxyFromEnv and the outbound proxies', () => {
  const POOL = {
    OUTBOUND_PROXY_URLS: 'http://u:p@a.example:8080, http://b.example:3128',
  };

  afterEach(() => {
    resetOutboundProxiesForTests();
    vi.restoreAllMocks();
  });

  it('takes the next outbound proxy for each run when VIDEO_INGEST_PROXY_URL is unset', () => {
    expect(proxyFlagsFromEnv(POOL)).toEqual([
      '--proxy',
      'http://u:p@a.example:8080',
    ]);
    expect(proxyFlagsFromEnv(POOL)).toEqual([
      '--proxy',
      'http://b.example:3128',
    ]);
  });

  it('lets VIDEO_INGEST_PROXY_URL take video ingestion out of the rotation', () => {
    const override = 'socks5h://user:pass@residential.example:1080';
    expect(
      ytdlpProxyFromEnv({ ...POOL, VIDEO_INGEST_PROXY_URL: override }),
    ).toEqual({ url: override, pooled: null });
    // The rotation did not move for it.
    expect(nextOutboundProxy(POOL)?.label).toBe('http://a.example:8080');
  });

  it('reads an invalid VIDEO_INGEST_PROXY_URL as absent, so the rotation carries the run', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      ytdlpProxyFromEnv({ ...POOL, VIDEO_INGEST_PROXY_URL: 'not a url' })?.url,
    ).toBe('http://u:p@a.example:8080');
  });

  it('runs without a proxy when neither is set', () => {
    expect(ytdlpProxyFromEnv({})).toBeNull();
    expect(buildAntiBotFlags({})).not.toContain('--proxy');
  });
});

describe('proxyFailedRun', () => {
  it.each([
    "ERROR: Unable to download API page: ('Unable to connect to proxy', ConnectionRefusedError(111, 'Connection refused'))",
    "ERROR: ('Unable to connect to proxy', OSError('Tunnel connection failed: 407 Proxy Authentication Required'))",
    'curl: (56) CONNECT tunnel failed, response 407',
    'curl: (5) Could not resolve proxy: p.example',
    // The platform's relay, for a yt-dlp in a sandbox session: its own
    // status for a proxy that could not be used.
    "ERROR: ('Unable to connect to proxy', OSError('Tunnel connection failed: 530 Video Proxy Unreachable'))",
    'curl: (56) CONNECT tunnel failed, response 530',
  ])('holds the proxy to blame for %j', (stderr) => {
    expect(proxyFailedRun(stderr)).toBe(true);
  });

  it.each([
    "ERROR: ('Unable to connect to proxy', OSError('Tunnel connection failed: 502 Bad Gateway'))",
    'curl: (56) CONNECT tunnel failed, response 403',
    "ERROR: ('Unable to connect to proxy', OSError('Tunnel connection failed: 403 Forbidden'))",
    // The relay's own refusal of a token says nothing against the proxy.
    "ERROR: ('Unable to connect to proxy', OSError('Tunnel connection failed: 531 Relay Token Refused'))",
    'curl: (56) CONNECT tunnel failed, response 531',
    "ERROR: ('Unable to connect to proxy', OSError('Tunnel connection failed: 503 Service Unavailable'))",
    'ERROR: [youtube] x: Sign in to confirm you are not a bot',
    'ERROR: HTTP Error 407: Proxy Authentication Required',
    'ERROR: [generic] Unable to extract title: the page says unable to connect to proxy',
  ])('does not for %j', (stderr) => {
    expect(proxyFailedRun(stderr)).toBe(false);
    expect(proxyFailedRun(stderr, true)).toBe(false);
  });

  // A yt-dlp in a sandbox session reaches its proxy through the platform's
  // relay. What the relay answered is the proxy's doing; a relay that
  // yt-dlp could not reach at all is the platform's own listener, restarting
  // or not at the address a session was given.
  describe("for a run that went through the platform's relay", () => {
    it.each([
      "ERROR: ('Unable to connect to proxy', OSError('Tunnel connection failed: 407 Proxy Authentication Required'))",
      'curl: (56) CONNECT tunnel failed, response 407',
      "ERROR: ('Unable to connect to proxy', OSError('Tunnel connection failed: 530 Video Proxy Unreachable'))",
      'curl: (56) CONNECT tunnel failed, response 530',
    ])('holds the proxy to blame for what the relay answered: %j', (stderr) => {
      expect(proxyFailedRun(stderr, true)).toBe(true);
    });

    it.each([
      "ERROR: Unable to download API page: ('Unable to connect to proxy', ConnectionRefusedError(111, 'Connection refused'))",
      "ERROR: ('Unable to connect to proxy', NewConnectionError('Failed to establish a new connection: [Errno 113] No route to host'))",
      'curl: (5) Could not resolve proxy: backend-api',
    ])('does not for a relay that could not be reached: %j', (stderr) => {
      expect(proxyFailedRun(stderr, true)).toBe(false);
      // The same words from a run beside this process are its proxy's.
      expect(proxyFailedRun(stderr)).toBe(true);
    });
  });
});

describe('configuredYtdlpProxyUrls — every proxy the relay may dial', () => {
  it('names the single proxy, the video list and the outbound list, as written', () => {
    expect(
      configuredYtdlpProxyUrls({
        VIDEO_INGEST_PROXY_URL: 'socks5h://one.example:1080',
        VIDEO_INGEST_PROXY_URLS:
          'http://u:p@v1.example:80, socks5://v2.example',
        OUTBOUND_PROXY_URLS: 'http://o1.example:8080',
      }),
    ).toEqual([
      'socks5h://one.example:1080',
      'http://u:p@v1.example:80',
      'socks5://v2.example',
      'http://o1.example:8080',
    ]);
  });

  it('names none where none is configured, and none for a single proxy that is no proxy', () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(configuredYtdlpProxyUrls({})).toEqual([]);
      expect(
        configuredYtdlpProxyUrls({ VIDEO_INGEST_PROXY_URL: 'ftp://x.example' }),
      ).toEqual([]);
    } finally {
      warned.mockRestore();
    }
  });
});

describe('a video through a list of proxies [VID-R7]', () => {
  // A stand-in yt-dlp on VIDEO_INGEST_BIN_DIR: it answers the version and
  // help probes, then adds the `--proxy` of each run to `proxies` in its HOME
  // (the job dir — the spawn env carries nothing else). A host listed in
  // `refused` fails the way yt-dlp does when its proxy refuses the
  // connection, one listed in `walled` meets YouTube's bot check, and a
  // private video fails through any proxy; otherwise it prints the metadata.
  const root = mkdtempSync(join(tmpdir(), 'tale-ytdlp-proxy-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'yt-dlp'),
    [
      '#!/bin/sh',
      'case "$1" in --help) exit 0 ;; --version) echo 2099.01.01; exit 0 ;; esac',
      'proxy=direct; prev=',
      'for arg in "$@"; do [ "$prev" = --proxy ] && proxy=$arg; prev=$arg; done',
      'echo "$proxy" >> "$HOME/proxies"',
      'printf "%s\\n" "$@" > "$HOME/args"',
      'host=${proxy##*@}; host=${host#*://}; host=${host%%:*}',
      'case "$*" in *v=private*)',
      `  echo "ERROR: [youtube] private: Private video. Sign in if you've been granted access to this video" >&2`,
      '  exit 1 ;;',
      'esac',
      `if grep -qx "$host" "${root}/refused" 2>/dev/null; then`,
      `  echo "ERROR: [youtube] x: Unable to download API page: ('Unable to connect to proxy', ConnectionRefusedError(111, 'Connection refused'))" >&2`,
      '  exit 1',
      'fi',
      `if grep -qx "$host" "${root}/walled" 2>/dev/null; then`,
      `  echo "ERROR: [youtube] x: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication." >&2`,
      '  exit 1',
      'fi',
      `echo '{"id": "x"}'`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const saved = {
    bin: process.env.VIDEO_INGEST_BIN_DIR,
    pool: process.env.OUTBOUND_PROXY_URLS,
    override: process.env.VIDEO_INGEST_PROXY_URL,
    own: process.env.VIDEO_INGEST_PROXY_URLS,
  };

  afterEach(() => {
    for (const [name, value] of [
      ['VIDEO_INGEST_BIN_DIR', saved.bin],
      ['OUTBOUND_PROXY_URLS', saved.pool],
      ['VIDEO_INGEST_PROXY_URL', saved.override],
      ['VIDEO_INGEST_PROXY_URLS', saved.own],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(join(root, 'refused'), { force: true });
    rmSync(join(root, 'walled'), { force: true });
    resetOutboundProxiesForTests();
    resetVideoIngestProxiesForTests();
    resetServingProxiesForTests();
    vi.restoreAllMocks();
  });

  /** Outbound proxies from `urls`, the hosts in `walled` meeting the bot
   * check and those in `refused` refusing the connection. */
  function deployment(
    urls: string,
    { walled = [], refused = [] }: { walled?: string[]; refused?: string[] },
  ): void {
    process.env.VIDEO_INGEST_BIN_DIR = bin;
    process.env.OUTBOUND_PROXY_URLS = urls;
    delete process.env.VIDEO_INGEST_PROXY_URL;
    delete process.env.VIDEO_INGEST_PROXY_URLS;
    writeFileSync(join(root, 'walled'), walled.map((h) => `${h}\n`).join(''));
    writeFileSync(join(root, 'refused'), refused.map((h) => `${h}\n`).join(''));
    resetOutboundProxiesForTests();
    resetVideoIngestProxiesForTests();
    resetServingProxiesForTests();
  }

  /** {@link deployment}, with video ingestion's own proxies from `own`. */
  function videoDeployment(
    own: string,
    outbound: string,
    hosts: { walled?: string[]; refused?: string[] },
  ): void {
    deployment(outbound, hosts);
    process.env.VIDEO_INGEST_PROXY_URLS = own;
  }

  /** A video's metadata through `route`: how the call ended, and the
   * `--proxy` of every run it made. */
  async function metadata(
    route?: YtdlpRoute,
    url = 'https://www.youtube.com/watch?v=x',
  ): Promise<{ outcome: string; proxies: string[] }> {
    const jobDir = mkdtempSync(join(root, 'job-'));
    const outcome = await ytdlpJson(
      url,
      localYtdlpPlace(jobDir),
      10_000,
      undefined,
      route,
    ).then(
      () => 'served',
      (error: unknown) =>
        error instanceof YtDlpError ? error.reason : String(error),
    );
    return { outcome, proxies: runProxies(jobDir) };
  }

  function runProxies(jobDir: string): string[] {
    const path = join(jobDir, 'proxies');
    return existsSync(path)
      ? readFileSync(path, 'utf8').trim().split('\n')
      : [];
  }

  function warnings(warn: { mock: { calls: unknown[][] } }): string {
    return warn.mock.calls.map((call) => String(call[0])).join('\n');
  }

  it('keeps a video on one proxy, and moves it on when the platform turns a run away', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deployment(
      'http://u:p@a.example:8080, http://b.example:3128, http://c.example:3128',
      { walled: ['a.example'] },
    );
    const route = YtdlpRoute.forVideo();
    const jobDir = mkdtempSync(join(root, 'job-'));

    await expect(
      ytdlpJson(
        'https://www.youtube.com/watch?v=x',
        localYtdlpPlace(jobDir),
        10_000,
        undefined,
        route,
      ),
    ).resolves.toEqual({ id: 'x' });
    // The captions and the sound go through the proxy that served the
    // metadata; the stand-in writes neither file, which is not an address's
    // failure and moves nothing.
    await expect(
      ytdlpWriteSubs(
        'https://www.youtube.com/watch?v=x',
        'en',
        localYtdlpPlace(jobDir),
        { route, timeoutMs: 10_000 },
      ),
    ).resolves.toBeNull();
    await expect(
      ytdlpFetchAudio(
        'https://www.youtube.com/watch?v=x',
        localYtdlpPlace(jobDir),
        10_000,
        undefined,
        route,
      ),
    ).rejects.toMatchObject({ reason: 'outputValidationFailed' });

    expect(runProxies(jobDir)).toEqual([
      'http://u:p@a.example:8080',
      'http://b.example:3128',
      'http://b.example:3128',
      'http://b.example:3128',
    ]);
    expect(warnings(warn)).toContain(
      '[ytdlp] outbound proxy entry 1 (http://a.example:8080) failed (botDetection); the video goes on through entry 2 (http://b.example:3128)',
    );
    expect(warnings(warn)).not.toContain('u:p@');
  });

  it('starts the next video on the proxy the platform last served, until it turns that one away', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    deployment(
      'http://a.example:3128, http://b.example:3128, http://c.example:3128',
      {},
    );
    expect(await metadata(YtdlpRoute.forVideo())).toEqual({
      outcome: 'served',
      proxies: ['http://a.example:3128'],
    });
    // Other requests to websites go on in turn…
    expect(nextOutboundProxy()?.label).toBe('http://b.example:3128');
    // …while the next video starts where the last one was served.
    expect(await metadata(YtdlpRoute.forVideo())).toEqual({
      outcome: 'served',
      proxies: ['http://a.example:3128'],
    });

    writeFileSync(join(root, 'walled'), 'a.example\n');
    expect(await metadata(YtdlpRoute.forVideo())).toEqual({
      outcome: 'served',
      proxies: ['http://a.example:3128', 'http://c.example:3128'],
    });
    expect(await metadata(YtdlpRoute.forVideo())).toEqual({
      outcome: 'served',
      proxies: ['http://c.example:3128'],
    });
  });

  it('passes over a proxy that cannot carry a run, and the run goes on through the next', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deployment('http://u:p@a.example:8080, http://b.example:3128', {
      refused: ['a.example'],
    });
    expect(await metadata()).toEqual({
      outcome: 'served',
      proxies: ['http://u:p@a.example:8080', 'http://b.example:3128'],
    });
    // a.example's turn, but it is passed over for its minute.
    expect(nextOutboundProxy()?.label).toBe('http://b.example:3128');
    expect(warnings(warn)).toContain('http://a.example:8080 failed');
    expect(warnings(warn)).not.toContain('u:p@');
  });

  // In a sandbox session yt-dlp's proxy is the platform's relay. A relay
  // it could not reach says nothing against the video's proxy: that one is
  // not passed over, and the video does not go on through the others for it.
  it('holds no proxy to blame for a relay that could not be reached', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deployment('http://a.example:3128, http://b.example:3128', {
      refused: ['a.example'],
    });
    const jobDir = mkdtempSync(join(root, 'job-'));
    const relayed = {
      ...localYtdlpPlace(jobDir),
      // As a session's place: the proxy is reached through a relay (here
      // one that hands the proxy's own address on, for the stand-in to
      // read which proxy the run was on).
      reach: { proxyUrl: (proxy: { url: string }) => proxy.url },
    };

    const outcome = await ytdlpJson(
      'https://www.youtube.com/watch?v=x',
      relayed,
      10_000,
    ).then(
      () => 'served',
      (error: unknown) =>
        error instanceof YtDlpError ? error.reason : String(error),
    );

    expect(outcome).toBe('transient');
    expect(runProxies(jobDir)).toEqual(['http://a.example:3128']);
    // a.example was not set aside: b.example's turn came, then a.example's.
    expect(nextOutboundProxy()?.label).toBe('http://b.example:3128');
    expect(nextOutboundProxy()?.label).toBe('http://a.example:3128');
    expect(warnings(warn)).not.toContain('failed');
  });

  it("does not run again for the video's own answer", async () => {
    deployment('http://a.example:3128, http://b.example:3128', {});
    expect(
      await metadata(undefined, 'https://www.youtube.com/watch?v=private'),
    ).toEqual({
      outcome: 'privateOrAgeGated',
      proxies: ['http://a.example:3128'],
    });
  });

  it('does not run again through a lone proxy or VIDEO_INGEST_PROXY_URL', async () => {
    deployment('http://a.example:3128', { walled: ['a.example', 'v.example'] });
    expect(await metadata()).toEqual({
      outcome: 'botDetection',
      proxies: ['http://a.example:3128'],
    });

    process.env.OUTBOUND_PROXY_URLS =
      'http://b.example:3128, http://c.example:3128';
    process.env.VIDEO_INGEST_PROXY_URL = 'http://v.example:3128';
    expect(await metadata()).toEqual({
      outcome: 'botDetection',
      proxies: ['http://v.example:3128'],
    });
  });

  it(`stops after ${MAX_PROXY_RUNS} runs`, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hosts = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(
      (name) => `${name}.example`,
    );
    deployment(hosts.map((host) => `http://${host}:3128`).join(', '), {
      walled: hosts,
    });
    expect(await metadata()).toEqual({
      outcome: 'botDetection',
      proxies: hosts
        .slice(0, MAX_PROXY_RUNS)
        .map((host) => `http://${host}:3128`),
    });
  });

  it('moves a video only to a proxy that has not failed it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    deployment('http://a.example:3128, http://b.example:3128', {
      walled: ['a.example', 'b.example'],
    });
    const route = YtdlpRoute.forVideo();
    expect(await metadata(route)).toEqual({
      outcome: 'botDetection',
      proxies: ['http://a.example:3128', 'http://b.example:3128'],
    });
    // Another call for the video stays where the route is: a.example has
    // failed it too, so there is no proxy left to move to.
    expect(await metadata(route)).toEqual({
      outcome: 'botDetection',
      proxies: ['http://b.example:3128'],
    });
  });

  it('takes a proxy listed twice once per video', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    deployment(
      'http://a.example:3128, http://a.example:3128, http://b.example:3128',
      { walled: ['a.example'] },
    );
    expect(await metadata(YtdlpRoute.forVideo())).toEqual({
      outcome: 'served',
      proxies: ['http://a.example:3128', 'http://b.example:3128'],
    });
  });

  it("keeps each platform's serving proxy to itself", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    deployment(
      'http://a.example:3128, http://b.example:3128, http://c.example:3128',
      {},
    );
    expect(await metadata(YtdlpRoute.forVideo('youtube'))).toEqual({
      outcome: 'served',
      proxies: ['http://a.example:3128'],
    });
    // Vimeo starts in turn, not where YouTube was served…
    expect(await metadata(YtdlpRoute.forVideo('vimeo'))).toEqual({
      outcome: 'served',
      proxies: ['http://b.example:3128'],
    });
    // …and Vimeo turning that address away leaves YouTube's start alone.
    writeFileSync(join(root, 'walled'), 'b.example\n');
    await metadata(YtdlpRoute.forVideo('vimeo'));
    expect(YtdlpRoute.forVideo('youtube').proxy?.url).toBe(
      'http://a.example:3128',
    );
  });

  it('no longer starts videos on a serving proxy the platform turned away', async () => {
    deployment(
      'http://a.example:3128, http://b.example:3128, http://c.example:3128',
      {},
    );
    expect((await metadata(YtdlpRoute.forVideo())).proxies).toEqual([
      'http://a.example:3128',
    ]);
    writeFileSync(join(root, 'walled'), 'a.example\n');
    const route = YtdlpRoute.forVideo();
    expect(route.proxy?.url).toBe('http://a.example:3128');
    // The window is spent after the first run, so the call ends on a.
    let reads = 0;
    vi.spyOn(Date, 'now').mockImplementation(() =>
      reads++ === 0 ? 1_000 : 601_000,
    );
    expect(await metadata(route)).toEqual({
      outcome: 'botDetection',
      proxies: ['http://a.example:3128'],
    });
    vi.restoreAllMocks();
    expect(YtdlpRoute.forVideo().proxy?.url).toBe('http://b.example:3128');
  });

  it("opens each step's window once, and starts a step off a proxy that failed the video", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deployment(
      'http://a.example:3128, http://b.example:3128, http://c.example:3128',
      { walled: ['a.example', 'b.example'] },
    );
    const route = YtdlpRoute.forVideo();
    // The step opens at 1 s; by its first failed run the clock reads 101 s.
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValue(101_000);
    expect(await metadata(route)).toEqual({
      outcome: 'botDetection',
      proxies: ['http://a.example:3128'],
    });
    // A second call of the same step (the Vimeo embed fallback) leaves the
    // failed proxy but gets no further run.
    expect(await metadata(route)).toEqual({
      outcome: 'botDetection',
      proxies: ['http://b.example:3128'],
    });
    route.nextStep();
    expect(await metadata(route)).toEqual({
      outcome: 'served',
      proxies: ['http://c.example:3128'],
    });
    expect(warnings(warn)).toContain(
      'entry 1 (http://a.example:3128) failed this video earlier; the video goes on through entry 2 (http://b.example:3128)',
    );
  });

  it('keeps a video on one of its own proxies, and moves it along its own list', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    videoDeployment(
      'socks5h://u:p@a.example:1080, http://b.example:3128, socks5://c.example',
      'http://o.example:3128, http://p.example:3128',
      { walled: ['a.example'] },
    );
    const route = YtdlpRoute.forVideo();
    const jobDir = mkdtempSync(join(root, 'job-'));

    await expect(
      ytdlpJson(
        'https://www.youtube.com/watch?v=x',
        localYtdlpPlace(jobDir),
        10_000,
        undefined,
        route,
      ),
    ).resolves.toEqual({ id: 'x' });
    await expect(
      ytdlpFetchAudio(
        'https://www.youtube.com/watch?v=x',
        localYtdlpPlace(jobDir),
        10_000,
        undefined,
        route,
      ),
    ).rejects.toMatchObject({ reason: 'outputValidationFailed' });

    expect(runProxies(jobDir)).toEqual([
      'socks5h://u:p@a.example:1080',
      'http://b.example:3128',
      'http://b.example:3128',
    ]);
    expect(warnings(warn)).toContain(
      '[ytdlp] video proxy entry 1 (socks5h://a.example:1080) failed (botDetection); the video goes on through entry 2 (http://b.example:3128)',
    );
    expect(warnings(warn)).not.toContain('u:p@');
    // The outbound proxies' turn never moved for the video.
    expect(nextOutboundProxy()?.label).toBe('http://o.example:3128');
  });

  it('starts the next video on the one of its own proxies the platform last served', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    videoDeployment(
      'http://a.example:3128, http://b.example:3128, http://c.example:3128',
      'http://o.example:3128',
      {},
    );
    expect(await metadata(YtdlpRoute.forVideo())).toEqual({
      outcome: 'served',
      proxies: ['http://a.example:3128'],
    });
    expect(await metadata(YtdlpRoute.forVideo())).toEqual({
      outcome: 'served',
      proxies: ['http://a.example:3128'],
    });
    writeFileSync(join(root, 'walled'), 'a.example\n');
    expect(await metadata(YtdlpRoute.forVideo())).toEqual({
      outcome: 'served',
      proxies: ['http://a.example:3128', 'http://b.example:3128'],
    });
    expect(await metadata(YtdlpRoute.forVideo())).toEqual({
      outcome: 'served',
      proxies: ['http://b.example:3128'],
    });
    // Where the video list served a platform says nothing to the outbound
    // proxies, once a deployment goes back to them.
    delete process.env.VIDEO_INGEST_PROXY_URLS;
    expect(YtdlpRoute.forVideo().proxy?.url).toBe('http://o.example:3128');
  });

  it("ends with the platform's reason once its own proxies have all failed the video, never going out through the outbound proxies or directly", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    videoDeployment(
      'http://a.example:3128, http://b.example:3128',
      'http://o.example:3128',
      { walled: ['a.example', 'b.example'] },
    );
    expect(await metadata(YtdlpRoute.forVideo())).toEqual({
      outcome: 'botDetection',
      proxies: ['http://a.example:3128', 'http://b.example:3128'],
    });
  });

  it('passes over one of its own proxies that cannot carry a run, apart from the outbound proxies', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    videoDeployment(
      'http://u:p@a.example:8080, http://b.example:3128',
      'http://u:p@a.example:8080, http://c.example:3128',
      { refused: ['a.example'] },
    );
    expect(await metadata()).toEqual({
      outcome: 'served',
      proxies: ['http://u:p@a.example:8080', 'http://b.example:3128'],
    });
    expect(warnings(warn)).toContain(
      '[video-proxy] http://a.example:8080 failed (yt-dlp could not get through); passing over it for 60 s',
    );
    expect(warnings(warn)).not.toContain('u:p@');
    // The outbound proxies still take a.example in its turn.
    expect(nextOutboundProxy()?.label).toBe('http://a.example:8080');
  });

  it(`stops after ${MAX_PROXY_RUNS} runs through its own proxies too`, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hosts = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(
      (name) => `${name}.example`,
    );
    videoDeployment(
      hosts.map((host) => `socks5h://${host}:1080`).join(', '),
      '',
      { walled: hosts },
    );
    expect(await metadata()).toEqual({
      outcome: 'botDetection',
      proxies: hosts
        .slice(0, MAX_PROXY_RUNS)
        .map((host) => `socks5h://${host}:1080`),
    });
  });

  it('starts every download over when a run goes again', async () => {
    deployment('http://a.example:3128', {});
    const jobDir = mkdtempSync(join(root, 'job-'));
    await ytdlpJson(
      'https://www.youtube.com/watch?v=x',
      localYtdlpPlace(jobDir),
      10_000,
    );
    expect(readFileSync(join(jobDir, 'args'), 'utf8').split('\n')).toContain(
      '--no-continue',
    );
  });

  it('starts no further run once the step has spent its window', async () => {
    deployment('http://a.example:3128, http://b.example:3128', {
      walled: ['a.example'],
    });
    const route = YtdlpRoute.forVideo();
    // The call starts at 1 s; by the time the first run has failed, the
    // clock reads ten minutes later.
    let reads = 0;
    vi.spyOn(Date, 'now').mockImplementation(() =>
      reads++ === 0 ? 1_000 : 601_000,
    );
    expect(await metadata(route)).toEqual({
      outcome: 'botDetection',
      proxies: ['http://a.example:3128'],
    });
  });
});

/**
 * yt-dlp downloads and converts nothing (tale-project/tale#4942): a run has
 * no ffmpeg, because a deployment's runs happen in a sandbox session whose
 * image carries none. The sound is stored as the platform serves it, and
 * the captions are read as the platform serves them.
 */
describe('what a run asks yt-dlp for, and what it takes of what yt-dlp leaves', () => {
  const root = mkdtempSync(join(tmpdir(), 'tale-ytdlp-output-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  // A stand-in yt-dlp: it keeps its arguments and leaves the files a test
  // names in `writes`, where the run was told to work.
  writeFileSync(
    join(bin, 'yt-dlp'),
    [
      '#!/bin/sh',
      'case "$1" in --help) exit 0 ;; --version) echo 2099.01.01; exit 0 ;; esac',
      'printf "%s\\n" "$@" > "$HOME/args"',
      `if [ -f "${root}/writes" ]; then`,
      '  while IFS= read -r name; do printf sound > "$HOME/$name"; done \\',
      `    < "${root}/writes"`,
      'fi',
      `if [ -f "${root}/says" ]; then cat "${root}/says"; fi`,
      `echo '{"id": "x"}'`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const saved = {
    bin: process.env.VIDEO_INGEST_BIN_DIR,
    pool: process.env.OUTBOUND_PROXY_URLS,
    override: process.env.VIDEO_INGEST_PROXY_URL,
    own: process.env.VIDEO_INGEST_PROXY_URLS,
  };
  afterEach(() => {
    for (const [name, value] of [
      ['VIDEO_INGEST_BIN_DIR', saved.bin],
      ['OUTBOUND_PROXY_URLS', saved.pool],
      ['VIDEO_INGEST_PROXY_URL', saved.override],
      ['VIDEO_INGEST_PROXY_URLS', saved.own],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(join(root, 'writes'), { force: true });
    rmSync(join(root, 'says'), { force: true });
  });

  /** A job dir, and what yt-dlp leaves in it when it runs. */
  function job(leaves: string[] = []): string {
    process.env.VIDEO_INGEST_BIN_DIR = bin;
    delete process.env.OUTBOUND_PROXY_URLS;
    delete process.env.VIDEO_INGEST_PROXY_URL;
    delete process.env.VIDEO_INGEST_PROXY_URLS;
    writeFileSync(join(root, 'writes'), leaves.map((n) => `${n}\n`).join(''));
    return mkdtempSync(join(root, 'job-'));
  }

  const args = (dir: string): string[] =>
    readFileSync(join(dir, 'args'), 'utf8').trim().split('\n');
  const URL_ = 'https://www.youtube.com/watch?v=x';

  describe('the sound', () => {
    it('is asked for as it is served, a stream of sound alone first, and nothing is done to it', async () => {
      const dir = job(['media.webm']);

      await ytdlpFetchAudio(URL_, localYtdlpPlace(dir), 10_000);

      const asked = args(dir);
      expect(asked.slice(asked.indexOf('-f'), asked.indexOf('-f') + 2)).toEqual(
        ['-f', 'bestaudio/best[height<=480]/best'],
      );
      expect(
        asked.slice(asked.indexOf('--fixup'), asked.indexOf('--fixup') + 2),
      ).toEqual(['--fixup', 'never']);
      // Under what one file of the video's session may weigh.
      expect(
        asked.slice(
          asked.indexOf('--max-filesize'),
          asked.indexOf('--max-filesize') + 2,
        ),
      ).toEqual(['--max-filesize', '1000M']);
      expect(MEDIA_MAX_BYTES).toBe(1024 * 1024 * 1024);
      expect(1000 * 1024 * 1024).toBeLessThan(MEDIA_MAX_BYTES);
      // The largest stream under the preferred size, in the original
      // language: sorted by size alone, yt-dlp takes a dubbed track that
      // weighs more (measured against 2026.10.26).
      expect(asked.slice(asked.indexOf('-S'), asked.indexOf('-S') + 2)).toEqual(
        ['-S', 'lang,size:200M'],
      );
      // A name of the lane's own, where the run works.
      expect(asked.slice(asked.indexOf('-o'), asked.indexOf('-o') + 2)).toEqual(
        ['-o', 'media.%(ext)s'],
      );
      expect(asked).toContain(`home:${dir}`);
      expect(asked).toContain(`temp:${dir}`);
      expect(asked.slice(-2)).toEqual(['--', URL_]);
      // No conversion: nothing that would have yt-dlp start ffmpeg.
      for (const flag of [
        '-x',
        '--extract-audio',
        '--audio-format',
        '--audio-quality',
        '--convert-subs',
        '--remux-video',
        '--recode-video',
      ]) {
        expect(asked).not.toContain(flag);
      }
    });

    it.each([
      ['webm', 'audio/webm'],
      ['m4a', 'audio/mp4'],
      ['mp4', 'video/mp4'],
      ['mp3', 'audio/mpeg'],
      ['opus', 'audio/ogg'],
      ['ogg', 'audio/ogg'],
      ['flac', 'audio/flac'],
      ['mkv', 'video/x-matroska'],
      ['ts', 'video/mp2t'],
    ])(
      'is taken as the .%s it arrived in, and named %s',
      async (extension, contentType) => {
        const dir = job([`media.${extension}`]);

        expect(
          await ytdlpFetchAudio(URL_, localYtdlpPlace(dir), 10_000),
        ).toEqual({
          name: `media.${extension}`,
          extension,
          contentType,
          // What the stand-in wrote: `sound`.
          size: 5,
        });
      },
    );

    it.each([
      ['nothing', []],
      ['a download that did not finish', ['media.webm.part']],
      ['a file in a container this lane does not take', ['media.exe']],
      ['a file under another name', ['x.webm', 'cookies.txt']],
      [
        "a file whose name only ends like the sound's",
        ['premedia.webm', 'x.media.m4a'],
      ],
      ['a name that leads elsewhere', ['media.webm.ytdl', 'media..webm']],
    ])('is none where yt-dlp left %s', async (_name, leaves) => {
      const dir = job(leaves);

      await expect(
        ytdlpFetchAudio(URL_, localYtdlpPlace(dir), 10_000),
      ).rejects.toMatchObject({
        reason: 'outputValidationFailed',
        message:
          'yt-dlp left no sound it was asked for: none in a container this lane takes',
      });
    });

    // yt-dlp does not start a stream that declares more than
    // `--max-filesize`, says so, and exits 0 (measured against 2026.10.26).
    it('is too large where the platform declares more than a file may be', async () => {
      const dir = job([]);
      writeFileSync(
        join(root, 'says'),
        '[download] File is larger than max-filesize (2104857600 bytes > 1048576000 bytes). Aborting.\n',
      );

      await expect(
        ytdlpFetchAudio(URL_, localYtdlpPlace(dir), 10_000),
      ).rejects.toMatchObject({
        reason: 'videoTooLarge',
        message:
          "the video's sound is larger than the 1073741824 bytes it may be: the platform declares more",
      });
    });

    // Where nothing stopped a download of no declared length (a place of
    // this machine, a session on Kubernetes), the file is measured.
    it('is too large where yt-dlp left more than a file may be, and is not read', async () => {
      const dir = job([]);
      // A file of a length and no bytes: nothing is written for it.
      writeFileSync(join(dir, 'media.webm'), '');
      truncateSync(join(dir, 'media.webm'), MEDIA_MAX_BYTES + 1);

      await expect(
        ytdlpFetchAudio(URL_, localYtdlpPlace(dir), 10_000),
      ).rejects.toMatchObject({
        reason: 'videoTooLarge',
        message:
          "the video's sound is larger than the 1073741824 bytes it may be: yt-dlp left 1073741825 bytes of it",
      });
    });

    it('is taken at exactly what a file may be', async () => {
      const dir = job([]);
      writeFileSync(join(dir, 'media.webm'), '');
      truncateSync(join(dir, 'media.webm'), MEDIA_MAX_BYTES);

      expect(
        await ytdlpFetchAudio(URL_, localYtdlpPlace(dir), 10_000),
      ).toMatchObject({ name: 'media.webm', size: MEDIA_MAX_BYTES });
    });

    it('is found beside what else a run left', async () => {
      const dir = job(['cookies.txt', 'subs.en.vtt', 'media.m4a']);

      expect(
        (await ytdlpFetchAudio(URL_, localYtdlpPlace(dir), 10_000)).name,
      ).toBe('media.m4a');
    });
  });

  describe('the captions', () => {
    it('are asked for as they are served, in WebVTT or else SubRip, and never converted', async () => {
      const dir = job(['subs.en.vtt']);

      await ytdlpWriteSubs(URL_, 'en', localYtdlpPlace(dir), {
        timeoutMs: 10_000,
      });

      const asked = args(dir);
      expect(
        asked.slice(
          asked.indexOf('--sub-format'),
          asked.indexOf('--sub-format') + 2,
        ),
      ).toEqual(['--sub-format', 'vtt/srt']);
      expect(asked).not.toContain('--convert-subs');
      expect(asked).toContain('--skip-download');
      expect(asked.slice(asked.indexOf('-o'), asked.indexOf('-o') + 2)).toEqual(
        ['-o', 'subs.%(ext)s'],
      );
      expect(
        asked.slice(
          asked.indexOf('--max-filesize'),
          asked.indexOf('--max-filesize') + 2,
        ),
      ).toEqual(['--max-filesize', '5M']);
      expect(CAPTIONS_MAX_BYTES).toBe(5 * 1024 * 1024);
      expect(asked).not.toContain('--write-auto-subs');
      expect(asked[asked.indexOf('--sub-langs') + 1]).toBe(
        'en,-danmaku,-ai-.*',
      );
    });

    it('include the generated ones only when they are asked for', async () => {
      const dir = job([]);

      await ytdlpWriteSubs(URL_, 'de', localYtdlpPlace(dir), {
        includeAutoGenerated: true,
        timeoutMs: 10_000,
      });

      expect(args(dir)).toContain('--write-auto-subs');
      expect(args(dir)[args(dir).indexOf('--sub-langs') + 1]).toBe(
        'de,-danmaku',
      );
    });

    it.each([
      [['subs.en.vtt'], { name: 'subs.en.vtt', format: 'vtt' }],
      [['subs.en.srt'], { name: 'subs.en.srt', format: 'srt' }],
      // WebVTT where a platform left both.
      [['subs.en.srt', 'subs.en.vtt'], { name: 'subs.en.vtt', format: 'vtt' }],
      [
        ['subs.zh-Hans.vtt', 'media.webm'],
        { name: 'subs.zh-Hans.vtt', format: 'vtt' },
      ],
    ])('are the track yt-dlp left: %j', async (leaves, track) => {
      const dir = job(leaves);

      expect(
        await ytdlpWriteSubs(URL_, 'en', localYtdlpPlace(dir), {
          timeoutMs: 10_000,
        }),
      ).toEqual(track);
    });

    it.each([
      ['nothing', []],
      [
        'a track in a format the platform does not read',
        ['subs.en.ttml', 'subs.en.json3'],
      ],
      [
        'a file that is no track of this run',
        ['other.en.vtt', 'subs.vtt.part'],
      ],
    ])('are none where yt-dlp left %s', async (_name, leaves) => {
      const dir = job(leaves);

      expect(
        await ytdlpWriteSubs(URL_, 'en', localYtdlpPlace(dir), {
          timeoutMs: 10_000,
        }),
      ).toBeNull();
    });

    it('refuse a language that is no language before anything runs', async () => {
      const dir = job([]);

      await expect(
        ytdlpWriteSubs(URL_, 'en,-danmaku,evil', localYtdlpPlace(dir)),
      ).rejects.toMatchObject({ reason: 'unsupported' });
      expect(existsSync(join(dir, 'args'))).toBe(false);
    });
  });
});

describe('a place of this machine', () => {
  const root = mkdtempSync(join(tmpdir(), 'tale-ytdlp-place-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const dirOf = (): string => mkdtempSync(join(root, 'job-'));

  it('reads a small file whole, and refuses one over what its caller takes', async () => {
    const dir = dirOf();
    writeFileSync(join(dir, 'subs.en.vtt'), 'WEBVTT\n');
    const place = localYtdlpPlace(dir);

    expect(Buffer.from(await place.readFile('subs.en.vtt', 7)).toString()).toBe(
      'WEBVTT\n',
    );
    await expect(place.readFile('subs.en.vtt', 6)).rejects.toMatchObject({
      reason: 'outputValidationFailed',
      message: 'yt-dlp left subs.en.vtt larger than the 6 bytes it may be',
    });
  });

  it('hands a file on as a stream of a known length', async () => {
    const dir = dirOf();
    writeFileSync(join(dir, 'media.webm'), Buffer.alloc(300_000, 7));
    const place = localYtdlpPlace(dir);

    const file = await place.openFile('media.webm', 300_000);

    expect(file.size).toBe(300_000);
    let read = 0;
    for await (const chunk of file.body) read += chunk.byteLength;
    expect(read).toBe(300_000);
    await expect(place.openFile('media.webm', 299_999)).rejects.toMatchObject({
      reason: 'outputValidationFailed',
    });
  });

  it('lists what the directory holds', async () => {
    const dir = dirOf();
    writeFileSync(join(dir, 'media.webm'), 'x');
    writeFileSync(join(dir, 'subs.en.vtt'), 'WEBVTT\n');
    // What is no file of the directory is no entry: a directory, and a
    // link, whatever it points at.
    mkdirSync(join(dir, 'a-directory'));
    symlinkSync(join(dir, 'media.webm'), join(dir, 'a-link.webm'));

    expect(
      (await localYtdlpPlace(dir).list()).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    ).toEqual([
      { name: 'media.webm', size: 1 },
      { name: 'subs.en.vtt', size: 7 },
    ]);
  });

  it('writes a file only its owner reads, and answers where yt-dlp finds it', async () => {
    const dir = dirOf();

    const path = await localYtdlpPlace(dir).writeFile('cookies.txt', 'a jar');

    expect(path).toBe(join(dir, 'cookies.txt'));
    expect(readFileSync(path, 'utf8')).toBe('a jar');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  // Even if yt-dlp's own sanitizer were bypassed, nothing is read that a
  // name could lead out to (the path-traversal class of CVE-2024-38519).
  it('reads nothing a link leads out of the directory to', async () => {
    const dir = dirOf();
    const outside = join(root, 'outside.txt');
    writeFileSync(outside, 'a secret');
    symlinkSync(outside, join(dir, 'media.webm'));
    const place = localYtdlpPlace(dir);

    await expect(place.readFile('media.webm', 1_000)).rejects.toMatchObject({
      reason: 'outputValidationFailed',
      message: `yt-dlp wrote outside its directory: ${outside}`,
    });
    await expect(place.openFile('media.webm', 1_000)).rejects.toMatchObject({
      reason: 'outputValidationFailed',
    });
  });

  it.each([
    '../outside.txt',
    'a/b.webm',
    '/etc/passwd',
    '.hidden',
    '',
    'a b.webm',
  ])('reads nothing under the name %j', async (name) => {
    const place = localYtdlpPlace(dirOf());

    await expect(place.readFile(name, 1_000)).rejects.toMatchObject({
      reason: 'outputValidationFailed',
    });
    expect(isPlainOutputName(name)).toBe(false);
  });

  it('is made in a directory of its own, which goes when it is disposed of', async () => {
    const place = await createLocalYtdlpPlace();

    expect(statSync(place.dir).mode & 0o777).toBe(0o700);
    await place.writeFile('cookies.txt', 'a jar');
    await place.dispose();

    expect(existsSync(place.dir)).toBe(false);
  });

  it('tells a run nothing of its surroundings: it reads the settings as they are', () => {
    expect(localYtdlpPlace(dirOf()).reach).toEqual({});
  });
});

describe('ytdlpRunOutcome — how a run ended, wherever it ran', () => {
  const end: YtdlpRunEnd = {
    code: 0,
    stdout: 'out',
    stderr: '',
    timedOut: false,
    outputCapped: false,
    timeoutMs: 90_000,
    outputCapBytes: 8 * 1024 * 1024,
  };
  const reasonOf = (run: Partial<YtdlpRunEnd>) => {
    try {
      ytdlpRunOutcome({ ...end, ...run });
      return 'served';
    } catch (error) {
      if (!(error instanceof YtDlpError)) throw error;
      return `${error.reason}: ${error.message}`;
    }
  };

  it('answers the output of a run that exited 0', () => {
    expect(ytdlpRunOutcome({ ...end, stderr: 'a warning' })).toEqual({
      stdout: 'out',
      stderr: 'a warning',
    });
  });

  it.each([
    [{ timedOut: true, code: null }, 'timeout: yt-dlp timed out after 90000ms'],
    // A run that was stopped at its time limit and still exited 0 was
    // stopped: its output is not trusted to be whole.
    [{ timedOut: true }, 'timeout: yt-dlp timed out after 90000ms'],
    [
      { outputCapped: true, code: null },
      'transient: yt-dlp output exceeded 8388608 bytes (cap-killed)',
    ],
    [
      { code: 1, stderr: 'ERROR: [youtube] x: Video unavailable' },
      'unavailable: yt-dlp exited 1 (reason: unavailable)',
    ],
    [
      {
        code: 1,
        stderr: 'ERROR: [youtube] x: Sign in to confirm you’re not a bot',
      },
      'botDetection: yt-dlp exited 1 (reason: botDetection)',
    ],
    [
      { code: 2, stderr: 'something new' },
      'transient: yt-dlp exited 2 (reason: transient)',
    ],
    [
      { code: null, stderr: '' },
      'transient: yt-dlp exited null (reason: transient)',
    ],
  ])('judges %j as %s', (run, reason) => {
    expect(reasonOf(run)).toBe(reason);
  });

  it('keeps nothing of stderr that names a credential', () => {
    try {
      ytdlpRunOutcome({
        ...end,
        code: 1,
        stderr:
          'ERROR: unable to reach socks5h://user-1:hunter2@gw.example:1080',
      });
      throw new Error('the run was served');
    } catch (error) {
      expect(error).toBeInstanceOf(YtDlpError);
      expect((error as YtDlpError).sanitizedStderr).not.toContain('hunter2');
    }
  });
});

describe('what a run is told of its surroundings', () => {
  const proxy = { url: 'socks5h://u:p@residential.example:1080', pooled: null };

  it('is given a proxy as the place reaches it', () => {
    expect(
      proxyFlagsFromEnv({}, proxy, {
        proxyUrl: (given) => `http://relay.internal/${given.url.length}`,
      }),
    ).toEqual(['--proxy', `http://relay.internal/${proxy.url.length}`]);
    // A place that says nothing gives the proxy as it is written.
    expect(proxyFlagsFromEnv({}, proxy, {})).toEqual(['--proxy', proxy.url]);
    expect(proxyFlagsFromEnv({}, null, { proxyUrl: () => 'never' })).toEqual(
      [],
    );
  });

  // The deployment's cookie jar lies on this machine's disk: a run
  // somewhere else reads a copy, or none, and never this machine's path.
  it("is given the deployment's cookie jar as the place holds it, or not at all", () => {
    const env = { VIDEO_INGEST_COOKIES_FILE: '/secrets/yt.txt' };

    expect(
      cookiesFlagsFromEnv(env, undefined, {
        cookiesFile: '/agent/output/deployment-cookies.txt',
      }),
    ).toEqual(['--cookies', '/agent/output/deployment-cookies.txt']);
    expect(cookiesFlagsFromEnv(env, undefined, { cookiesFile: null })).toEqual(
      [],
    );
    // A place that says nothing reads the setting as it is.
    expect(cookiesFlagsFromEnv(env, undefined, {})).toEqual([
      '--cookies',
      '/secrets/yt.txt',
    ]);
    // A pooled session's jar comes first wherever the run is.
    expect(
      cookiesFlagsFromEnv(
        env,
        { cookiesFile: '/agent/output/cookies.txt' },
        { cookiesFile: '/agent/output/deployment-cookies.txt' },
      ),
    ).toEqual(['--cookies', '/agent/output/cookies.txt']);
    // And the whole flag set follows the place.
    const flags = buildAntiBotFlags(env, undefined, null, {
      cookiesFile: null,
    });
    expect(flags).not.toContain('--cookies');
    expect(
      buildAntiBotFlags(env, undefined, null, {
        cookiesFile: '/agent/output/deployment-cookies.txt',
      }),
    ).toContain('/agent/output/deployment-cookies.txt');
  });

  it('is given the PO-token provider as the place reaches it, with the plugin the place has', () => {
    const env = { VIDEO_INGEST_POT_PROVIDER: 'true' };
    const flags = buildAntiBotFlags(env, undefined, null, {
      potProviderUrl: 'http://backend-api:3005/api/video-relay/pot/v1.a.b',
      pluginDir: '/opt/yt-dlp/plugins',
    });

    expect(flags).toContain(
      'youtubepot-bgutilhttp:base_url=http://backend-api:3005/api/video-relay/pot/v1.a.b',
    );
    expect(
      flags.slice(
        flags.indexOf('--plugin-dirs'),
        flags.indexOf('--plugin-dirs') + 2,
      ),
    ).toEqual(['--plugin-dirs', '/opt/yt-dlp/plugins']);
    // A provider is asked for every token, as with one beside the run.
    expect(flags.join(' ')).toContain('player_client=default,mweb,tv_simply');
    expect(flags.join(' ')).toContain('fetch_pot=always');
  });

  it('is given no provider and no plugin where the place has none, whatever this process has', () => {
    const flags = buildAntiBotFlags(
      {
        VIDEO_INGEST_POT_PROVIDER_URL: 'http://pot.internal:4416',
        VIDEO_INGEST_YTDLP_PLUGIN_DIRS: '/host/plugins',
      },
      undefined,
      null,
      { potProviderUrl: null, pluginDir: null },
    );

    expect(flags.join(' ')).not.toContain('youtubepot-bgutilhttp');
    expect(flags).not.toContain('--plugin-dirs');
    expect(flags.join(' ')).toContain('player_client=default,tv_simply');
  });
});

describe('youtubeExtractorArgsFromEnv', () => {
  it('uses the resilient default player-client list', () => {
    expect(youtubeExtractorArgsFromEnv({})).toEqual([
      '--extractor-args',
      'youtube:player_client=default,tv_simply',
    ]);
  });

  it('honours a player-client override', () => {
    expect(
      youtubeExtractorArgsFromEnv({
        VIDEO_INGEST_PLAYER_CLIENT: 'default,mweb',
      }),
    ).toEqual(['--extractor-args', 'youtube:player_client=default,mweb']);
  });

  it('appends a manually supplied PO token to the youtube arg', () => {
    expect(
      youtubeExtractorArgsFromEnv({ VIDEO_INGEST_PO_TOKEN: 'mweb.gvs+TOK' }),
    ).toEqual([
      '--extractor-args',
      'youtube:player_client=default,tv_simply;po_token=mweb.gvs+TOK',
    ]);
  });

  it('adds a separate extractor-arg for the PO token provider', () => {
    const flags = youtubeExtractorArgsFromEnv({
      VIDEO_INGEST_POT_PROVIDER_URL: 'http://127.0.0.1:4416',
    });
    expect(flags).toContain(
      'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
    );
    // Provider present → widen the client list to include mweb (PO-Token
    // Guide) and force PLAYER-context token fetches (auto never asks for one).
    expect(flags).toContain(
      'youtube:player_client=default,mweb,tv_simply;fetch_pot=always',
    );
  });

  it('ignores an invalid provider URL', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const flags = youtubeExtractorArgsFromEnv({
      VIDEO_INGEST_POT_PROVIDER_URL: 'nonsense',
    });
    expect(flags.join(' ')).not.toContain('bgutil');
    warn.mockRestore();
  });

  it('asks the bundled provider where the deployment turned it on and the plugin is baked in', () => {
    // hasBakedPlugin=true simulates the self-hosted image, where the bgutil
    // plugin dir exists; the one variable is all the deployment sets.
    const flags = youtubeExtractorArgsFromEnv(
      { VIDEO_INGEST_POT_PROVIDER: 'true' },
      undefined,
      true,
    );
    expect(flags).toContain(
      'youtubepot-bgutilhttp:base_url=http://bgutil-provider:4416',
    );
    expect(flags).toContain(
      'youtube:player_client=default,mweb,tv_simply;fetch_pot=always',
    );
  });

  // The provider is a container the deployment starts only when asked: an
  // image that ships the plugin must not go looking for it on its own.
  it('asks no provider in an image that ships the plugin until the deployment turns it on', () => {
    for (const env of [
      {},
      { VIDEO_INGEST_POT_PROVIDER: 'false' },
      { VIDEO_INGEST_POT_PROVIDER: '' },
      { VIDEO_INGEST_POT_PROVIDER: 'yes' },
    ]) {
      expect(youtubeExtractorArgsFromEnv(env, undefined, true)).toEqual([
        '--extractor-args',
        'youtube:player_client=default,tv_simply',
      ]);
    }
  });

  it('turns nothing on where the image ships no plugin', () => {
    expect(
      youtubeExtractorArgsFromEnv(
        { VIDEO_INGEST_POT_PROVIDER: 'true' },
        undefined,
        false,
      ),
    ).toEqual(['--extractor-args', 'youtube:player_client=default,tv_simply']);
  });

  it('does not emit fetch_pot without a provider', () => {
    const flags = youtubeExtractorArgsFromEnv({}, undefined, false);
    expect(flags.join(' ')).not.toContain('fetch_pot');
  });

  it('honours a VIDEO_INGEST_FETCH_POT override', () => {
    const flags = youtubeExtractorArgsFromEnv(
      { VIDEO_INGEST_FETCH_POT: 'never', VIDEO_INGEST_POT_PROVIDER: 'true' },
      undefined,
      true,
    );
    expect(flags).toContain(
      'youtube:player_client=default,mweb,tv_simply;fetch_pot=never',
    );
    // An explicit value applies even without a provider (e.g. an operator
    // running a plugin from VIDEO_INGEST_YTDLP_PLUGIN_DIRS only).
    const noProvider = youtubeExtractorArgsFromEnv(
      { VIDEO_INGEST_FETCH_POT: 'always' },
      undefined,
      false,
    );
    expect(noProvider).toContain(
      'youtube:player_client=default,tv_simply;fetch_pot=always',
    );
  });

  it('ignores an invalid VIDEO_INGEST_FETCH_POT (logged, not thrown)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const flags = youtubeExtractorArgsFromEnv(
      {
        VIDEO_INGEST_FETCH_POT: 'sometimes',
        VIDEO_INGEST_POT_PROVIDER: 'true',
      },
      undefined,
      true,
    );
    expect(flags).toContain(
      'youtube:player_client=default,mweb,tv_simply;fetch_pot=always',
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not default the provider URL without the baked plugin', () => {
    const flags = youtubeExtractorArgsFromEnv({}, undefined, false);
    expect(flags.join(' ')).not.toContain('bgutil');
  });

  it('lets an explicit provider URL override the baked default', () => {
    const flags = youtubeExtractorArgsFromEnv(
      { VIDEO_INGEST_POT_PROVIDER_URL: 'http://custom:9999' },
      undefined,
      true,
    );
    expect(flags).toContain(
      'youtubepot-bgutilhttp:base_url=http://custom:9999',
    );
    expect(flags.join(' ')).not.toContain('bgutil-provider');
  });
});

describe('cookies / impersonate flags', () => {
  it('are empty by default and set when configured', () => {
    expect(cookiesFlagsFromEnv({})).toEqual([]);
    expect(
      cookiesFlagsFromEnv({ VIDEO_INGEST_COOKIES_FILE: '/secrets/yt.txt' }),
    ).toEqual(['--cookies', '/secrets/yt.txt']);
    expect(impersonateFlagsFromEnv({})).toEqual([]);
    expect(
      impersonateFlagsFromEnv({ VIDEO_INGEST_IMPERSONATE: 'safari' }),
    ).toEqual(['--impersonate', 'safari']);
  });
});

describe('buildAntiBotFlags', () => {
  it('always includes light request pacing and the youtube extractor arg', () => {
    const flags = buildAntiBotFlags({});
    expect(flags).toEqual(
      expect.arrayContaining([
        '--sleep-requests',
        '1',
        '--extractor-args',
        'youtube:player_client=default,tv_simply',
      ]),
    );
    // No proxy/cookies/impersonate on a default build.
    expect(flags).not.toContain('--proxy');
    expect(flags).not.toContain('--cookies');
    expect(flags).not.toContain('--impersonate');
  });

  it('composes every configured mitigation', () => {
    const flags = buildAntiBotFlags({
      VIDEO_INGEST_PROXY_URL: 'socks5h://p:1',
      VIDEO_INGEST_COOKIES_FILE: '/c.txt',
      VIDEO_INGEST_IMPERSONATE: 'chrome',
      VIDEO_INGEST_PLAYER_CLIENT: 'default,mweb',
    });
    expect(flags).toEqual(
      expect.arrayContaining([
        '--proxy',
        'socks5h://p:1',
        '--cookies',
        '/c.txt',
        '--impersonate',
        'chrome',
        'youtube:player_client=default,mweb',
      ]),
    );
  });
});

describe('sanitizeStderr', () => {
  it('redacts inline proxy credentials in any scheme', () => {
    const out = sanitizeStderr(
      'ERROR: Unable to connect to proxy socks5h://alice:s3cret@host:1080',
    );
    expect(out).not.toContain('s3cret');
    expect(out).not.toContain('alice');
  });

  it('redacts PO tokens and cookie flags', () => {
    expect(sanitizeStderr('debug po_token=ABC123DEF')).not.toContain(
      'ABC123DEF',
    );
    expect(sanitizeStderr('cmd --cookies /secrets/jar.txt')).toContain(
      '--cookies <redacted>',
    );
  });
});

describe('pooled session support', () => {
  it("prefers a session's cookie jar over the env path", () => {
    const flags = cookiesFlagsFromEnv(
      { VIDEO_INGEST_COOKIES_FILE: '/env/jar.txt' },
      { cookiesFile: '/job/cookies.txt' },
    );
    expect(flags).toEqual(['--cookies', '/job/cookies.txt']);
  });

  it("threads a session's visitor_data + po_token into the youtube arg", () => {
    const flags = youtubeExtractorArgsFromEnv(
      {},
      { visitorData: 'VD123', poToken: 'mweb.gvs+TOK' },
    );
    expect(flags).toContain(
      'youtube:player_client=default,tv_simply;po_token=mweb.gvs+TOK;visitor_data=VD123',
    );
  });

  it('composes the full anti-bot flag set with a session', () => {
    const flags = buildAntiBotFlags(
      { VIDEO_INGEST_PROXY_URL: 'socks5h://p:1' },
      { cookiesFile: '/job/c.txt', visitorData: 'VD' },
    );
    expect(flags).toEqual(
      expect.arrayContaining([
        '--proxy',
        'socks5h://p:1',
        '--cookies',
        '/job/c.txt',
        'youtube:player_client=default,tv_simply;visitor_data=VD',
      ]),
    );
  });
});

describe('pluginDirFlagsFromEnv', () => {
  it('is empty by default and set when configured', () => {
    expect(pluginDirFlagsFromEnv({})).toEqual([]);
    expect(
      pluginDirFlagsFromEnv({
        VIDEO_INGEST_YTDLP_PLUGIN_DIRS: '/etc/yt-dlp/plugins',
      }),
    ).toEqual(['--plugin-dirs', '/etc/yt-dlp/plugins']);
  });

  it('falls back to the baked plugin dir where a run has a provider to ask', () => {
    const baked = ['--plugin-dirs', '/opt/yt-dlp/plugins'];
    expect(
      pluginDirFlagsFromEnv({ VIDEO_INGEST_POT_PROVIDER: 'true' }, true),
    ).toEqual(baked);
    expect(
      pluginDirFlagsFromEnv(
        { VIDEO_INGEST_POT_PROVIDER_URL: 'http://pot.example:4416' },
        true,
      ),
    ).toEqual(baked);
  });

  // Loaded without one, the plugin looks for a provider on the loopback.
  it('loads no plugin where no provider is asked', () => {
    expect(pluginDirFlagsFromEnv({}, true)).toEqual([]);
    expect(
      pluginDirFlagsFromEnv({ VIDEO_INGEST_POT_PROVIDER: 'false' }, true),
    ).toEqual([]);
    expect(
      pluginDirFlagsFromEnv({ VIDEO_INGEST_POT_PROVIDER: 'true' }, false),
    ).toEqual([]);
  });

  it('prefers an explicit env dir over the baked default', () => {
    expect(
      pluginDirFlagsFromEnv({ VIDEO_INGEST_YTDLP_PLUGIN_DIRS: '/x' }, true),
    ).toEqual(['--plugin-dirs', '/x']);
  });
});

describe('bgutilPluginInstallDir', () => {
  // Guards the nesting contract that yt-dlp requires for --plugin-dirs:
  // the zip's yt_dlp_plugins/ must live under a named child, not the root.
  it('nests the bgutil package under a named child of the plugin-dirs root', () => {
    expect(BGUTIL_PLUGIN_NEST_DIR).toBe('bgutil');
    expect(bgutilPluginInstallDir('/opt/yt-dlp/plugins')).toBe(
      '/opt/yt-dlp/plugins/bgutil',
    );
  });
});

describe('buildSpawnPath', () => {
  it('pins the production PATH when unset', () => {
    expect(buildSpawnPath({})).toBe('/usr/local/bin:/usr/bin:/bin');
  });

  it('prepends VIDEO_INGEST_BIN_DIR when set', () => {
    expect(buildSpawnPath({ VIDEO_INGEST_BIN_DIR: '/cache/bin' })).toBe(
      '/cache/bin:/usr/local/bin:/usr/bin:/bin',
    );
  });

  it('ignores a blank override', () => {
    expect(buildSpawnPath({ VIDEO_INGEST_BIN_DIR: '   ' })).toBe(
      '/usr/local/bin:/usr/bin:/bin',
    );
  });
});

describe('ffmpegLocationFlags', () => {
  it('defaults to the baked /usr/bin/ffmpeg', () => {
    expect(ffmpegLocationFlags({})).toEqual([
      '--ffmpeg-location',
      '/usr/bin/ffmpeg',
    ]);
  });

  it('honours VIDEO_INGEST_FFMPEG_LOCATION', () => {
    expect(
      ffmpegLocationFlags({
        VIDEO_INGEST_FFMPEG_LOCATION: '/opt/homebrew/bin/ffmpeg',
      }),
    ).toEqual(['--ffmpeg-location', '/opt/homebrew/bin/ffmpeg']);
  });

  it('falls back to the default for a blank override', () => {
    expect(ffmpegLocationFlags({ VIDEO_INGEST_FFMPEG_LOCATION: '  ' })).toEqual(
      ['--ffmpeg-location', '/usr/bin/ffmpeg'],
    );
  });
});

describe('the yt-dlp version floor', () => {
  it('orders date-shaped versions, nightly suffix included', () => {
    expect(compareYtdlpVersions('2026.03.17', '2026.07.04')).toBeLessThan(0);
    expect(compareYtdlpVersions('2026.08.19', '2026.07.04')).toBeGreaterThan(0);
    expect(compareYtdlpVersions('2026.07.04', '2026.07.04')).toBe(0);
    // A same-day nightly is newer than the release it builds on.
    expect(
      compareYtdlpVersions('2026.07.04.232805', '2026.07.04'),
    ).toBeGreaterThan(0);
    // Zero-padding is cosmetic; the components are numbers.
    expect(compareYtdlpVersions('2026.7.4', '2026.07.04')).toBe(0);
  });

  it('emits the stale-binary warning where the dev loop will show it', () => {
    // `bun dev` pipes the backend through `classifyBackend`, which surfaces a
    // line only when it carries ERROR or WARN and drops everything else as
    // noise. This warning exists to be READ — if it classifies as noise, a
    // developer goes on reading a stale binary's failures as platform blocks,
    // which is the exact confusion it was added to prevent.
    const warning = ytdlpVersionWarning('2026.03.17');
    expect(classifyBackend(warning).kind).toBe('warn');
    // And it has to say what to do about it.
    expect(warning).toContain('2026.03.17');
    expect(warning).toContain(MIN_YTDLP_VERSION);
    expect(warning).toContain('VIDEO_INGEST_BIN_DIR');
  });

  it('never exceeds the version the image pins', () => {
    // The floor is what we warn a dev host about. If it ever rose above the
    // pin of the image a deployment's yt-dlp runs in, the warning would stop
    // meaning "your host is behind production".
    const here = dirname(fileURLToPath(import.meta.url));
    const dockerfile = readFileSync(
      join(here, '../../../../sandbox-runtime/Dockerfile'),
      'utf8',
    );
    const pinned = /^ARG YTDLP_VERSION=(\S+)$/m.exec(dockerfile)?.[1];
    expect(pinned).toBeDefined();
    expect(
      compareYtdlpVersions(MIN_YTDLP_VERSION, pinned as string),
    ).toBeLessThanOrEqual(0);
  });

  // A video link's yt-dlp runs in a sandbox session, never beside the
  // application (tale-project/tale#4942): the application's image carries
  // none of its tools, and so nothing to keep in step with the session's.
  it("is pinned in the session's image alone: the application's carries no yt-dlp", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const platform = readFileSync(join(here, '../../../Dockerfile'), 'utf8');

    for (const tool of [
      'YTDLP_VERSION',
      'DENO_VERSION',
      'BGUTIL_POT_VERSION',
      'yt-dlp/yt-dlp/releases',
      'denoland/deno/releases',
      'bgutil-ytdlp-pot-provider/releases',
      '/usr/local/bin/yt-dlp',
      '/usr/local/bin/deno',
      '/opt/yt-dlp',
    ]) {
      expect(platform).not.toContain(tool);
    }
    // ffmpeg stays: the transcription lane converts a video's sound here.
    expect(platform).toMatch(/apt-get install .*\bffmpeg\b/);
  });
});

describe('the bundled PO-token provider', () => {
  it('is on only where the deployment says true', () => {
    expect(potProviderOn({})).toBe(false);
    expect(potProviderOn({ VIDEO_INGEST_POT_PROVIDER: 'true' })).toBe(true);
    expect(potProviderOn({ VIDEO_INGEST_POT_PROVIDER: ' TRUE ' })).toBe(true);
    for (const raw of ['false', '', '1', 'yes', 'on'])
      expect(potProviderOn({ VIDEO_INGEST_POT_PROVIDER: raw })).toBe(false);
  });

  it('is asked at its own address, unless the deployment names another provider', () => {
    expect(potProviderUrl({ VIDEO_INGEST_POT_PROVIDER: 'true' }, true)).toBe(
      'http://bgutil-provider:4416',
    );
    expect(
      potProviderUrl(
        {
          VIDEO_INGEST_POT_PROVIDER: 'true',
          VIDEO_INGEST_POT_PROVIDER_URL: ' http://pot.example:4416 ',
        },
        true,
      ),
    ).toBe('http://pot.example:4416');
    // A provider of the deployment's own needs neither the switch nor the
    // bundled plugin's image.
    expect(
      potProviderUrl(
        { VIDEO_INGEST_POT_PROVIDER_URL: 'http://pot.example:4416' },
        false,
      ),
    ).toBe('http://pot.example:4416');
    expect(potProviderUrl({}, true)).toBeUndefined();
    expect(
      potProviderUrl({ VIDEO_INGEST_POT_PROVIDER: 'true' }, false),
    ).toBeUndefined();
  });
});

describe('botWallReason', () => {
  it('names the setting where YouTube walls a deployment that has no PO tokens', () => {
    expect(botWallReason('youtube', {}, true)).toBe('poTokenProviderOff');
    expect(botWallReason('youtube', {}, false)).toBe('poTokenProviderOff');
    expect(
      botWallReason('youtube', { VIDEO_INGEST_POT_PROVIDER: 'false' }, true),
    ).toBe('poTokenProviderOff');
  });

  it('is the platform’s own wall once the deployment has a source of tokens', () => {
    expect(
      botWallReason('youtube', { VIDEO_INGEST_POT_PROVIDER: 'true' }, true),
    ).toBe('botDetection');
    expect(
      botWallReason(
        'youtube',
        { VIDEO_INGEST_POT_PROVIDER_URL: 'http://pot.example:4416' },
        false,
      ),
    ).toBe('botDetection');
    expect(
      botWallReason('youtube', { VIDEO_INGEST_PO_TOKEN: 'mweb.gvs+TOK' }, true),
    ).toBe('botDetection');
  });

  // PO tokens are YouTube's: no other platform's wall is answered with them.
  it.each(['bilibili', 'vimeo', 'twitch', 'dailymotion', 'generic'])(
    'is the platform’s own wall on %s, whatever the deployment has',
    (platform) => {
      expect(botWallReason(platform, {}, true)).toBe('botDetection');
      expect(
        botWallReason(platform, { VIDEO_INGEST_POT_PROVIDER: 'true' }, true),
      ).toBe('botDetection');
    },
  );
});
